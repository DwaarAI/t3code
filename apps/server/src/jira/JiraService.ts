/**
 * JiraService - Jira Cloud tickets through the REST API v3, with one
 * connection per server: site URL, account email and API token, kept in the
 * server secret store. Clients and agents read and write Markdown; this module
 * converts it to and from Jira's document format.
 */
import {
  type JiraComment,
  type JiraConfigureInput,
  type JiraConnection,
  JiraError,
  type JiraErrorReason,
  type JiraIssueDetail,
  type JiraIssueSummary,
  type JiraStatusCategory,
  type JiraTransition,
  type JiraUpdateIssueInput,
  type JiraUser,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { adfToMarkdown, markdownToAdf } from "./adf.ts";
import { childrenJql, issueBrowseUrl, keysJql, normalizeSiteUrl, searchJql } from "./jiraQuery.ts";

const SECRET_NAME = "jira-connection";
const SEARCH_LIMIT = 25;
const SUMMARY_FIELDS = ["summary", "status", "issuetype", "priority", "assignee", "parent"];
const DETAIL_FIELDS = [
  ...SUMMARY_FIELDS,
  "reporter",
  "labels",
  "description",
  "created",
  "updated",
];

export class JiraService extends Context.Service<
  JiraService,
  {
    readonly status: () => Effect.Effect<JiraConnection, JiraError>;
    readonly configure: (input: JiraConfigureInput) => Effect.Effect<JiraConnection, JiraError>;
    readonly search: (query: string) => Effect.Effect<ReadonlyArray<JiraIssueSummary>, JiraError>;
    /** Summaries for known keys, in the order given; missing tickets are left out. */
    readonly summaries: (
      keys: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<JiraIssueSummary>, JiraError>;
    readonly getIssue: (key: string) => Effect.Effect<JiraIssueDetail, JiraError>;
    readonly updateIssue: (
      input: JiraUpdateIssueInput,
    ) => Effect.Effect<JiraIssueDetail, JiraError>;
    readonly addComment: (key: string, markdown: string) => Effect.Effect<JiraComment, JiraError>;
    readonly transition: (
      key: string,
      transitionId: string,
    ) => Effect.Effect<JiraIssueDetail, JiraError>;
  }
>()("t3/jira/JiraService") {}

const StoredConnection = Schema.Struct({
  baseUrl: Schema.String,
  email: Schema.String,
  apiToken: Schema.String,
});
type StoredConnection = typeof StoredConnection.Type;
const StoredConnectionJson = Schema.fromJsonString(StoredConnection);
const decodeStoredConnection = Schema.decodeUnknownEffect(StoredConnectionJson);
const encodeStoredConnection = Schema.encodeEffect(StoredConnectionJson);

const RawUser = Schema.NullOr(
  Schema.Struct({ accountId: Schema.String, displayName: Schema.optional(Schema.String) }),
);
const Named = Schema.NullOr(Schema.Struct({ name: Schema.String }));

const RawIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          name: Schema.String,
          statusCategory: Schema.optional(Schema.Struct({ key: Schema.String })),
        }),
      ),
    ),
    issuetype: Schema.optional(Named),
    priority: Schema.optional(Named),
    assignee: Schema.optional(RawUser),
    reporter: Schema.optional(RawUser),
    parent: Schema.optional(Schema.NullOr(Schema.Struct({ key: Schema.String }))),
    labels: Schema.optional(Schema.Array(Schema.String)),
    description: Schema.optional(Schema.Unknown),
    created: Schema.optional(Schema.String),
    updated: Schema.optional(Schema.String),
  }),
});
type RawIssue = typeof RawIssue.Type;

const decodeSearch = Schema.decodeUnknownEffect(Schema.Struct({ issues: Schema.Array(RawIssue) }));
const decodeIssue = Schema.decodeUnknownEffect(RawIssue);
const RawComment = Schema.Struct({
  id: Schema.String,
  author: Schema.optional(RawUser),
  body: Schema.optional(Schema.Unknown),
  created: Schema.String,
  updated: Schema.String,
});
const decodeComment = Schema.decodeUnknownEffect(RawComment);
const decodeComments = Schema.decodeUnknownEffect(
  Schema.Struct({ comments: Schema.Array(RawComment) }),
);
const decodeTransitions = Schema.decodeUnknownEffect(
  Schema.Struct({
    transitions: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        to: Schema.optional(Schema.Struct({ name: Schema.String })),
      }),
    ),
  }),
);
const decodeErrorBody = Schema.decodeUnknownEffect(
  Schema.Struct({
    errorMessages: Schema.optional(Schema.Array(Schema.String)),
    errors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
);

const toUser = (user: typeof RawUser.Type | undefined): JiraUser | null =>
  user ? { accountId: user.accountId, displayName: user.displayName ?? user.accountId } : null;

const toCategory = (key: string | undefined): JiraStatusCategory =>
  key === "done" || key === "indeterminate" ? key : "new";

const toSummary = (siteUrl: string, issue: RawIssue): JiraIssueSummary => ({
  key: issue.key,
  summary: issue.fields.summary ?? "",
  status: issue.fields.status?.name ?? "Unknown",
  statusCategory: toCategory(issue.fields.status?.statusCategory?.key),
  issueType: issue.fields.issuetype?.name ?? "Issue",
  priority: issue.fields.priority?.name ?? null,
  assignee: toUser(issue.fields.assignee),
  parentKey: issue.fields.parent?.key ?? null,
  url: issueBrowseUrl(siteUrl, issue.key),
});

const toComment = (comment: typeof RawComment.Type): JiraComment => ({
  id: comment.id,
  author: toUser(comment.author),
  body: adfToMarkdown(comment.body),
  created: comment.created,
  updated: comment.updated,
});

const fail = (reason: JiraErrorReason, detail: string, cause?: unknown) =>
  new JiraError({ reason, detail, ...(cause === undefined ? {} : { cause }) });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readConnection = Effect.suspend(() => secrets.get(SECRET_NAME)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(null),
        onSome: (bytes) =>
          decodeStoredConnection(decoder.decode(bytes)).pipe(Effect.orElseSucceed(() => null)),
      }),
    ),
    Effect.mapError((cause) =>
      fail("request_failed", "Could not read the Jira connection.", cause),
    ),
  );

  const requireConnection = readConnection.pipe(
    Effect.flatMap((connection) =>
      connection
        ? Effect.succeed(connection)
        : Effect.fail(
            fail("not_configured", "Connect Jira in Settings → Source control to use tickets."),
          ),
    ),
  );

  const describeFailure = (response: HttpClientResponse.HttpClientResponse, action: string) =>
    response.json.pipe(
      Effect.flatMap(decodeErrorBody),
      Effect.map((body) =>
        [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join(" "),
      ),
      Effect.orElseSucceed(() => ""),
      Effect.map((message) => {
        const detail = `${action}: ${message || `Jira answered ${response.status}`}`;
        if (response.status === 401 || response.status === 403) {
          return fail("unauthorized", `${detail}. Check the Jira email and API token.`);
        }
        if (response.status === 404) return fail("not_found", detail);
        if (response.status === 400) return fail("invalid_input", detail);
        return fail("request_failed", detail);
      }),
    );

  /** Sends one request; resolves to the parsed JSON body, or null for empty replies. */
  const send = (
    connection: StoredConnection,
    action: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ) =>
    Effect.gen(function* () {
      const url = `${connection.baseUrl}/rest/api/3${path}`;
      const base =
        method === "GET"
          ? HttpClientRequest.get(url)
          : method === "POST"
            ? HttpClientRequest.post(url)
            : HttpClientRequest.put(url);
      const authed = base.pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.basicAuth(connection.email, connection.apiToken),
      );
      const request = body === undefined ? authed : yield* HttpClientRequest.bodyJson(authed, body);
      const response = yield* httpClient.execute(request);
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(yield* describeFailure(response, action));
      }
      if (response.status === 204) return null;
      return yield* response.json;
    }).pipe(
      Effect.catchTags({
        HttpBodyError: (cause) => Effect.fail(fail("invalid_input", `${action}.`, cause)),
        HttpClientError: (cause) =>
          Effect.fail(fail("request_failed", `${action}: ${cause.message}`, cause)),
      }),
    );

  const decoded = <A, E>(action: string, effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((cause) =>
        fail("request_failed", `${action}: unexpected response from Jira.`, cause),
      ),
    );

  const searchWith = (connection: StoredConnection, action: string, jql: string, limit: number) =>
    send(connection, action, "POST", "/search/jql", {
      jql,
      fields: SUMMARY_FIELDS,
      maxResults: limit,
    }).pipe(
      Effect.flatMap((body) => decoded(action, decodeSearch(body))),
      Effect.map((result) => result.issues.map((issue) => toSummary(connection.baseUrl, issue))),
    );

  const status: JiraService["Service"]["status"] = () =>
    readConnection.pipe(
      Effect.map((connection) => ({
        configured: connection !== null,
        baseUrl: connection?.baseUrl ?? null,
        email: connection?.email ?? null,
      })),
    );

  const configure: JiraService["Service"]["configure"] = (input) =>
    Effect.gen(function* () {
      const baseUrl = normalizeSiteUrl(input.baseUrl);
      if (baseUrl === null) {
        return yield* fail("invalid_input", "Enter the Jira site as an https URL.");
      }
      const apiToken = input.apiToken ?? (yield* readConnection)?.apiToken;
      if (!apiToken) return yield* fail("invalid_input", "Enter a Jira API token.");
      const connection = { baseUrl, email: input.email, apiToken };
      // Check the login before saving it, so a typo never replaces a working one.
      yield* send(connection, "Could not sign in to Jira", "GET", "/myself");
      const encoded = yield* encodeStoredConnection(connection).pipe(
        Effect.mapError((cause) => fail("invalid_input", "Could not save the connection.", cause)),
      );
      yield* secrets
        .set(SECRET_NAME, encoder.encode(encoded))
        .pipe(
          Effect.mapError((cause) =>
            fail("request_failed", "Could not save the Jira connection.", cause),
          ),
        );
      return { configured: true, baseUrl, email: input.email };
    });

  const search: JiraService["Service"]["search"] = (query) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection;
      return yield* searchWith(connection, "Could not search Jira", searchJql(query), SEARCH_LIMIT);
    });

  const summaries: JiraService["Service"]["summaries"] = (keys) =>
    Effect.gen(function* () {
      if (keys.length === 0) return [];
      const connection = yield* requireConnection;
      const found = yield* searchWith(
        connection,
        "Could not read the folder's tickets",
        keysJql(keys),
        keys.length,
      );
      return keys.flatMap((key) => found.find((issue) => issue.key === key) ?? []);
    });

  const getIssue: JiraService["Service"]["getIssue"] = (key) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection;
      const action = `Could not read ${key}`;
      const [issueBody, children, commentsBody, transitionsBody] = yield* Effect.all(
        [
          send(connection, action, "GET", `/issue/${key}?fields=${DETAIL_FIELDS.join(",")}`),
          searchWith(connection, action, childrenJql(key), 100),
          send(connection, action, "GET", `/issue/${key}/comment?orderBy=created&maxResults=100`),
          send(connection, action, "GET", `/issue/${key}/transitions`),
        ],
        { concurrency: "unbounded" },
      );
      const issue = yield* decoded(action, decodeIssue(issueBody));
      const comments = yield* decoded(action, decodeComments(commentsBody));
      const transitions = yield* decoded(action, decodeTransitions(transitionsBody));
      return {
        ...toSummary(connection.baseUrl, issue),
        description: adfToMarkdown(issue.fields.description),
        labels: issue.fields.labels ?? [],
        reporter: toUser(issue.fields.reporter),
        created: issue.fields.created ?? "",
        updated: issue.fields.updated ?? "",
        children,
        comments: comments.comments.map(toComment),
        transitions: transitions.transitions.map((transition): JiraTransition => ({
          id: transition.id,
          name: transition.name,
          toStatus: transition.to?.name ?? transition.name,
        })),
      };
    });

  const updateIssue: JiraService["Service"]["updateIssue"] = (input) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection;
      const fields: Record<string, unknown> = {};
      if (input.summary !== undefined) fields.summary = input.summary;
      if (input.description !== undefined) fields.description = markdownToAdf(input.description);
      if (input.labels !== undefined) fields.labels = input.labels;
      if (Object.keys(fields).length > 0) {
        yield* send(connection, `Could not update ${input.key}`, "PUT", `/issue/${input.key}`, {
          fields,
        });
      }
      return yield* getIssue(input.key);
    });

  const addComment: JiraService["Service"]["addComment"] = (key, markdown) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection;
      const action = `Could not comment on ${key}`;
      const body = yield* send(connection, action, "POST", `/issue/${key}/comment`, {
        body: markdownToAdf(markdown),
      });
      return toComment(yield* decoded(action, decodeComment(body)));
    });

  const transition: JiraService["Service"]["transition"] = (key, transitionId) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection;
      yield* send(
        connection,
        `Could not change the status of ${key}`,
        "POST",
        `/issue/${key}/transitions`,
        {
          transition: { id: transitionId },
        },
      );
      return yield* getIssue(key);
    });

  return JiraService.of({
    status,
    configure,
    search,
    summaries,
    getIssue,
    updateIssue,
    addComment,
    transition,
  });
});

export const layer = Layer.effect(JiraService, make);

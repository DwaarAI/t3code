import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as JiraService from "./JiraService.ts";

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const issue = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  fields: {
    summary: `Summary ${key}`,
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    issuetype: { name: "Story" },
    priority: { name: "High" },
    assignee: { accountId: "a1", displayName: "Ana" },
    parent: null,
    ...overrides,
  },
});

/**
 * A fake Jira site: answers by path, records what was sent, and keeps the
 * stored connection in memory as the secret store would.
 */
const withJira = <A, E>(
  routes: (method: string, path: string, body: unknown) => { status: number; json?: unknown },
  body: (input: {
    readonly jira: JiraService.JiraService["Service"];
    readonly sent: Sent[];
  }) => Effect.Effect<A, E>,
) => {
  const sent: Sent[] = [];
  const secrets = new Map<string, Uint8Array>();
  return Effect.gen(function* () {
    const jira = yield* JiraService.JiraService;
    return yield* body({ jira, sent });
  }).pipe(
    Effect.provide(
      JiraService.layer.pipe(
        Layer.provide(
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            get: (name) => Effect.succeed(Option.fromNullishOr(secrets.get(name))),
            set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
          }),
        ),
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.sync(() => {
                const raw =
                  request.body._tag === "Uint8Array"
                    ? new TextDecoder().decode(request.body.body)
                    : null;
                const parsed: unknown = raw === null ? undefined : parseJson(raw);
                const url = new URL(request.url);
                const path = url.pathname.replace("/rest/api/3", "") + url.search;
                sent.push({
                  method: request.method,
                  url: request.url,
                  authorization: request.headers.authorization,
                  body: parsed,
                });
                const answer = routes(request.method, path, parsed);
                return HttpClientResponse.fromWeb(
                  request,
                  new Response(answer.json === undefined ? null : toJson(answer.json), {
                    status: answer.status,
                    headers: { "content-type": "application/json" },
                  }),
                );
              }),
            ),
          ),
        ),
      ),
    ),
  );
};

const connect = (jira: JiraService.JiraService["Service"]) =>
  jira.configure({
    baseUrl: "https://acme.atlassian.net/jira/your-work",
    email: "dev@acme.test",
    apiToken: "secret",
  });

describe("JiraService", () => {
  it.effect("refuses to work before a connection is saved", () =>
    withJira(
      () => ({ status: 500 }),
      ({ jira, sent }) =>
        Effect.gen(function* () {
          expect(yield* jira.status()).toEqual({ configured: false, baseUrl: null, email: null });
          expect((yield* Effect.flip(jira.search("checkout"))).reason).toBe("not_configured");
          expect(sent).toEqual([]);
        }),
    ),
  );

  it.effect("checks the login before saving it and keeps the token on later edits", () =>
    withJira(
      (_method, path) =>
        path === "/myself" ? { status: 200, json: { accountId: "a1" } } : { status: 404 },
      ({ jira, sent }) =>
        Effect.gen(function* () {
          expect(yield* connect(jira)).toEqual({
            configured: true,
            baseUrl: "https://acme.atlassian.net",
            email: "dev@acme.test",
          });
          expect(sent[0]?.authorization).toBe(`Basic ${btoa("dev@acme.test:secret")}`);
          // A new email without a token reuses the saved one.
          yield* jira.configure({ baseUrl: "https://acme.atlassian.net", email: "ops@acme.test" });
          expect(sent[1]?.authorization).toBe(`Basic ${btoa("ops@acme.test:secret")}`);
          expect((yield* jira.status()).email).toBe("ops@acme.test");
        }),
    ),
  );

  it.effect("does not replace a working login with one Jira rejects", () =>
    withJira(
      (_method, path, _body) =>
        path === "/myself"
          ? { status: 401, json: { errorMessages: ["Unauthorized"] } }
          : { status: 404 },
      ({ jira }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(connect(jira));
          expect(error.reason).toBe("unauthorized");
          expect((yield* jira.status()).configured).toBe(false);
        }),
    ),
  );

  it.effect("reads a ticket with its children, comments and transitions as Markdown", () =>
    withJira(
      (method, path) => {
        if (path === "/myself") return { status: 200, json: {} };
        if (method === "GET" && path.startsWith("/issue/DW-1?"))
          return {
            status: 200,
            json: issue("DW-1", {
              labels: ["api"],
              created: "2026-09-01T00:00:00.000+0000",
              updated: "2026-09-02T00:00:00.000+0000",
              description: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Build it" }] }],
              },
            }),
          };
        if (path === "/search/jql")
          return { status: 200, json: { issues: [issue("DW-2", { parent: { key: "DW-1" } })] } };
        if (path.startsWith("/issue/DW-1/comment"))
          return {
            status: 200,
            json: {
              comments: [
                {
                  id: "10",
                  author: { accountId: "a2", displayName: "Bo" },
                  body: {
                    type: "doc",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "LGTM" }] }],
                  },
                  created: "c",
                  updated: "u",
                },
              ],
            },
          };
        if (path === "/issue/DW-1/transitions")
          return {
            status: 200,
            json: { transitions: [{ id: "31", name: "Done", to: { name: "Done" } }] },
          };
        return { status: 404 };
      },
      ({ jira, sent }) =>
        Effect.gen(function* () {
          yield* connect(jira);
          const detail = yield* jira.getIssue("DW-1");
          expect(detail).toMatchObject({
            key: "DW-1",
            status: "In Progress",
            statusCategory: "indeterminate",
            description: "Build it",
            labels: ["api"],
            url: "https://acme.atlassian.net/browse/DW-1",
            children: [{ key: "DW-2", parentKey: "DW-1" }],
            comments: [{ id: "10", body: "LGTM", author: { displayName: "Bo" } }],
            transitions: [{ id: "31", name: "Done", toStatus: "Done" }],
          });
          expect(sent.find((entry) => entry.url.endsWith("/search/jql"))?.body).toMatchObject({
            jql: "parent = DW-1 ORDER BY key ASC",
          });
        }),
    ),
  );

  it.effect("writes Markdown as Jira documents and reports field errors", () =>
    withJira(
      (method, path) => {
        if (path === "/myself") return { status: 200, json: {} };
        if (method === "PUT") return { status: 400, json: { errors: { summary: "Too long" } } };
        if (method === "POST" && path === "/issue/DW-1/comment")
          return {
            status: 201,
            json: { id: "11", body: { type: "doc", content: [] }, created: "c", updated: "u" },
          };
        return { status: 404 };
      },
      ({ jira, sent }) =>
        Effect.gen(function* () {
          yield* connect(jira);
          const comment = yield* jira.addComment("DW-1", "Ship **it**");
          expect(comment.id).toBe("11");
          expect(sent.at(-1)?.body).toEqual({
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Ship " },
                    { type: "text", text: "it", marks: [{ type: "strong" }] },
                  ],
                },
              ],
            },
          });
          const error = yield* Effect.flip(jira.updateIssue({ key: "DW-1", summary: "x" }));
          expect(error.reason).toBe("invalid_input");
          expect(error.message).toContain("Too long");
        }),
    ),
  );

  it.effect("keeps attached tickets in the order given and drops missing ones", () =>
    withJira(
      (_method, path) =>
        path === "/myself"
          ? { status: 200, json: {} }
          : { status: 200, json: { issues: [issue("DW-3"), issue("DW-1")] } },
      ({ jira, sent }) =>
        Effect.gen(function* () {
          yield* connect(jira);
          const found = yield* jira.summaries(["DW-1", "DW-9", "DW-3"]);
          expect(found.map((entry) => entry.key)).toEqual(["DW-1", "DW-3"]);
          expect(sent.at(-1)?.body).toMatchObject({ jql: "key in (DW-1, DW-9, DW-3)" });
        }),
    ),
  );
});

/**
 * Pure helpers for the Jira client: what a search box means as JQL, and the
 * site URL and ticket links the server stores and returns.
 */

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/;
// Operators only: a bare "in" or "is" is just as likely in a plain search.
const JQL_SYNTAX = /(!=|!~|>=|<=|[=~<>]|\b(?:not\s+)?in\s*\(|\border\s+by\b)/i;

const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * A search box entry as JQL: a ticket key finds that ticket, text that already
 * reads as JQL is used as is, and anything else is a full-text search.
 */
export function searchJql(query: string): string {
  const trimmed = query.trim();
  if (ISSUE_KEY.test(trimmed)) return `key = ${trimmed.toUpperCase()}`;
  if (JQL_SYNTAX.test(trimmed)) return trimmed;
  return `text ~ ${quote(trimmed)} ORDER BY updated DESC`;
}

/** JQL for the given tickets, in no particular order. */
export const keysJql = (keys: ReadonlyArray<string>) => `key in (${keys.join(", ")})`;

/** JQL for a ticket's sub-tasks and child issues. */
export const childrenJql = (key: string) => `parent = ${key} ORDER BY key ASC`;

/**
 * The site origin for a configured URL, or null for one that is not an
 * absolute https URL. Paths are dropped: the REST API lives at the root.
 */
export function normalizeSiteUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  return url.protocol === "https:" ? url.origin : null;
}

export const issueBrowseUrl = (siteUrl: string, key: string) => `${siteUrl}/browse/${key}`;

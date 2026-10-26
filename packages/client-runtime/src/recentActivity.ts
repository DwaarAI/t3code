import type { RecentActivitySort } from "@t3tools/contracts/settings";

export const RECENT_ACTIVITY_LIMIT = 10;

export interface RecentActivityThread {
  readonly updatedAt: string;
  readonly latestUserMessageAt: string | null;
  readonly lastVisitedAt?: string | null | undefined;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
}

const timeOf = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const sortKey = (thread: RecentActivityThread, sort: RecentActivitySort): number | null => {
  switch (sort) {
    case "updated":
      return timeOf(thread.updatedAt);
    case "prompt":
      return timeOf(thread.latestUserMessageAt);
    case "viewed":
      return timeOf(thread.lastVisitedAt);
  }
};

const newestFirst = (left: number | null, right: number | null) =>
  // Threads without the timestamp sort after every thread that has one.
  (right ?? Number.NEGATIVE_INFINITY) - (left ?? Number.NEGATIVE_INFINITY);

/**
 * The stack is the threads this user opened most recently, across every
 * environment; `sort` only reorders that stack. `lastVisitedAt` is the
 * server's visited watermark, so the stack is the same on every device.
 */
export function selectRecentActivity<T extends RecentActivityThread>(
  threads: Iterable<T>,
  sort: RecentActivitySort,
  limit = RECENT_ACTIVITY_LIMIT,
): ReadonlyArray<T> {
  const stack = [...threads]
    .filter(
      (thread) =>
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        timeOf(thread.lastVisitedAt) !== null,
    )
    .sort((left, right) => newestFirst(timeOf(left.lastVisitedAt), timeOf(right.lastVisitedAt)))
    .slice(0, limit);
  if (sort === "viewed") return stack;
  return [...stack].sort(
    (left, right) =>
      newestFirst(sortKey(left, sort), sortKey(right, sort)) ||
      newestFirst(timeOf(left.lastVisitedAt), timeOf(right.lastVisitedAt)),
  );
}

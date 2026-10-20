import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

vi.mock("expo-sqlite", () => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-secure-store", () => ({}));

import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";
import * as MobileSecureStorage from "./mobile-secure-storage";

function loadStored(payload: object) {
  return MobilePreferences.make().pipe(
    Effect.flatMap((store) => store.load),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(MobileDatabase.MobileDatabase)({
          loadPreferencesJson: Effect.succeed(
            Option.some({ payload: JSON.stringify(payload), updatedAt: 1 }),
          ),
        }),
        Layer.mock(MobileSecureStorage.MobileSecureStorage)({
          getItem: () => Effect.succeed(null),
          removeItem: () => Effect.void,
        }),
      ),
    ),
  );
}

describe("mobile preferences attention reminders", () => {
  it.effect("keeps a stored reminder delay, including off", () =>
    Effect.gen(function* () {
      expect((yield* loadStored({ attentionReminderMinutes: 10 })).attentionReminderMinutes).toBe(
        10,
      );
      expect((yield* loadStored({ attentionReminderMinutes: 0 })).attentionReminderMinutes).toBe(0);
    }),
  );

  it.effect("drops a reminder delay that is not a whole number of minutes in range", () =>
    Effect.gen(function* () {
      for (const attentionReminderMinutes of [-1, 2.5, 24 * 60 + 1, "5", null]) {
        const preferences = yield* loadStored({ attentionReminderMinutes, baseFontSize: 17 });
        expect(preferences).not.toHaveProperty("attentionReminderMinutes");
        expect(preferences.baseFontSize).toBe(17);
      }
    }),
  );
});

describe("mobile preferences recent activity sort", () => {
  it.effect("keeps a known sort", () =>
    Effect.gen(function* () {
      for (const recentActivitySort of ["updated", "prompt", "viewed"] as const) {
        expect((yield* loadStored({ recentActivitySort })).recentActivitySort).toBe(
          recentActivitySort,
        );
      }
    }),
  );

  it.effect("drops an unknown sort without losing other preferences", () =>
    Effect.gen(function* () {
      for (const recentActivitySort of ["created", "", 1, null]) {
        const preferences = yield* loadStored({ recentActivitySort, baseFontSize: 17 });
        expect(preferences).not.toHaveProperty("recentActivitySort");
        expect(preferences.baseFontSize).toBe(17);
      }
    }),
  );
});

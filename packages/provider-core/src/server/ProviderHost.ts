import type {
  BackgroundScope,
  ChatAttachment,
  ServerSettings,
  ServerSettingsError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { ProviderCompatibilityLookup } from "./compatibility.ts";
import type { ProviderCredentialError } from "./errors.ts";

export interface ProviderHostPaths {
  readonly cwd: string;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly providerStatusCacheDir: string;
  /** Where chat attachments are stored; agents that sandbox file reads must be granted it. */
  readonly attachmentsDir: string;
}

export interface ProviderCredentials {
  /** Instances whose bindings are equal share these credentials. */
  readonly binding: { readonly owner: "t3"; readonly key: string };
  readonly get: Effect.Effect<Option.Option<Uint8Array>, ProviderCredentialError>;
  readonly set: (credentials: Uint8Array) => Effect.Effect<void, ProviderCredentialError>;
  readonly remove: Effect.Effect<void, ProviderCredentialError>;
}

/**
 * Extra context the host gives a session in a given cwd, beyond the cwd itself:
 * folder worktrees bring instructions and sibling directories, and every session
 * may read the shared guides users attach to messages.
 */
export interface ProviderSessionContext {
  /** Appended to the session's runtime or system instructions. */
  readonly instructions: string | null;
  /** Directories outside the cwd the agent may read, for providers that gate reads. */
  readonly readableDirs: ReadonlyArray<string>;
  /**
   * Directories outside the cwd the agent's sandbox must let it write, for
   * providers that read anywhere. Each lies inside a readable directory.
   */
  readonly writableDirs: ReadonlyArray<string>;
}

export class ProviderHost extends Context.Service<
  ProviderHost,
  {
    readonly paths: ProviderHostPaths;
    readonly settings: {
      readonly get: Effect.Effect<ServerSettings, ServerSettingsError>;
      /** Runs `use` on a settings snapshot that no settings write can change until it finishes. */
      readonly withSnapshot: <A, E, R>(
        use: (settings: ServerSettings) => Effect.Effect<A, E, R>,
      ) => Effect.Effect<A, E | ServerSettingsError, R>;
      readonly changes: Stream.Stream<ServerSettings>;
      /** Changes buffered from the moment the scoped subscription is acquired. */
      readonly subscribe: Effect.Effect<Stream.Stream<ServerSettings>, never, Scope.Scope>;
    };
    readonly shouldRunBackgroundWork: (scope: BackgroundScope) => Effect.Effect<boolean>;
    /** Completes once server startup finishes; first provider checks wait for it. */
    readonly awaitServerReady?: Effect.Effect<void>;
    /** Absolute attachment path, or null if the ID does not resolve inside attachmentsDir. */
    readonly resolveAttachmentPath: (attachment: ChatAttachment) => string | null;
    readonly sessionContext: (cwd: string | null | undefined) => ProviderSessionContext;
    readonly resolveExtractedTextPath?: (path: string) => Effect.Effect<string | undefined>;
    /**
     * Counts a running agent for local server discovery, so listeners carrying its
     * T3CODE_THREAD_ID show under its thread. Call the returned function when it stops.
     */
    readonly trackAgent?: () => () => void;
    readonly credentials: (
      namespace: string,
      bindingId: string,
    ) => Effect.Effect<ProviderCredentials>;
    /** A driver declares its minimum version in the policy and asks here, not in a constant. */
    readonly compatibility: ProviderCompatibilityLookup;
  }
>()("@t3tools/provider-core/server/ProviderHost") {}

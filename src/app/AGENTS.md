# Application Services

`src/app/` owns application-scoped state services and adapters used by the composition root. Features and providers access these capabilities through stable host and core contracts rather than importing the concrete plugin class.

## Dependency Direction

- `src/main.ts` is the concrete composition root. It constructs app services and wires core registries, providers, and features.
- App repositories, storage, and settings services depend on core contracts. They must not import chat views, feature controllers, renderers, or provider-native protocol implementations.
- `FeatureHost` is the feature-facing application boundary; user-facing features must not import `ClaudianPlugin` from `src/main.ts`.
- `ProviderHost` is the provider-facing application boundary; provider runtime code must not reach through it to chat views or feature controllers.
- Concrete provider imports are allowed only in composition and provider-default assembly. Do not introduce them into conversation, storage, or settings transaction logic.
- Existing Claude compatibility imports of app settings or storage are migration seams. Do not use them as precedent; move a shared contract into `core/` before creating another provider-to-app dependency.

## Ownership

| Component | Authority |
| --- | --- |
| `ConversationRepository` | The canonical in-memory Claudian conversation collection, device-versus-unscoped metadata ownership and explicit assignment, hydration status, pin/archive and creation-only Linked content identity, deletion transactions, per-conversation persistence queues, input-ledger coordination, Claudian-owned message-transcript persistence and replay for `supportsNativeHistory: false` providers, historical model recovery, selected-model availability reconciliation, and execution-snapshot binding |
| `SharedStorageService` | Plugin-data and vault persistence I/O plus construction of shared persistence adapters |
| `ClaudianSettingsStorage` | Settings persistence and retryable migration of current-device provider maps from legacy device-key aliases to the filesystem-safe key |
| `SettingsCoordinator` | Serialization of settings mutations, rollback before failed persistence, and post-commit publication ordering |
| `ChatModelSelectionCoordinator` | Application-wide ordering and durable settings commits for explicit future-tab model-seed intents |
| `PinnedLinkedContentPathCoordinator` | Pinned Linked content path mutation, folder-descendant rewrite, deduplication, and deletion cleanup through ordered settings transactions |
| `TabWorkspaceMigrationCoordinator` | Cross-leaf coordination of actual Obsidian view-state delivery and the one-time claim and cleanup of legacy plugin-global tab state |
| Leave and retirement coordinators | Authority-backed individual departure, pending ordinary-Member Leave settlement, exact local cleanup, terminal Project convergence, acknowledgement, and retained minimum terminal response |
| Accepted-main synchronizer | Serialized current-Member fetch/inspection and exact fast-forward only when authoritative coordination and local state prove the Project has no contribution; it never creates or updates a request |
| Publication candidate Git boundary | Exact-ref clean/conflicting planning, private candidate retention, confirmed personal-branch fast-forward, and checked internal-ref cleanup without visible conflict markers |
| Publication mutation safety | Exact worktree, index, ref, publication-record, and Git-lock revalidation; correctness does not depend on detecting editors or agent executions |
| Working-tree review service and repository | Content-addressed local review snapshots whose non-deleted file metadata includes a captured SHA-256 identity; every later file read recomputes that identity and rejects drift instead of trusting size or timestamps |
| LAN lifecycle gateway | The exhaustive lifecycle operation/security/admission policy. Routes own wire/path/header context validation and raw bearer extraction; the active or terminal gateway owns policy authentication, admission selection, typed dispatch, and deferred-result forwarding |
| `ClaudianProviderHost` | Typed delegation to application capabilities; it owns no duplicate settings, storage, view, or execution state |

Storage adapters own I/O mechanics, not domain decisions. Callers decide what state is valid; adapters merge and persist it without inventing conversation, tab, provider, or settings semantics.

## State and Persistence Boundaries

- `ConversationRepository` is the source of truth for Claudian's current in-memory conversation projection. Feature code must request conversation mutations through `FeatureHost` instead of mutating cached conversations independently.
- Claudian metadata and accepted-input ledgers are durable Claudian state.
- Provider session IDs, resume checkpoints, and opaque `providerState` may be interpreted only by provider snapshots or typed provider history/state helpers. Generic app code may store those opaque values but must not infer or rewrite their fields.
- Persisted tab workspaces are view-scoped shells owned by the chat feature. Application storage exposes the former plugin-global `AppTabManagerState` only as a one-time migration source; it must not become a second live tab-state authority.
- Only `TabWorkspaceMigrationCoordinator` may read or retire the legacy global snapshot. Normal startup does not preload metadata from it; the claiming view loads metadata for the shells selected by its restore policy.
- Legacy tab migration decisions use state actually delivered to live views. A live view's synthesized `getState()` output is not evidence that Obsidian restored a view-scoped snapshot; deferred leaves may contribute their serialized leaf state directly.
- Once the aggregate leaf declarations include any view-scoped snapshot, including a deferred leaf, the migration coordinator retires the legacy global snapshot so it cannot become eligible again after that leaf is removed.
- Before a view restores conversation-backed tab shells, the application conversation repository must adopt metadata for every conversation selected by the restore policy. Deferred history scanning remains responsible for all other sessions.
- `Conversation.modelRecoverySource` is a read-only native locator used only to recover missing historical model metadata. It must never be treated as a resumable provider binding, and a successful recovery or fresh provider session retires it.
- `Conversation.linkedContentPath` is an optional canonical Vault-relative file or folder path. The Vault root is not a valid Linked content target. It is creation-only identity: ordinary patches, live-object mutation, saves, forks after creation, and deletion must not replace or clear it. Only the repository's explicit Vault-rename rewrite may change it, including descendants for folder renames; deletion leaves the identity durable so presentation can report Missing content.
- `SharedStorageService.setTabManagerState()` plus legacy tab-state reads and cleanup must preserve unrelated plugin data.
- Settings changes must go through `SettingsCoordinator` or the application mutation APIs so persistence, rollback, provider reconciliation, and publication remain ordered.
- Provider model-option changes reconcile affected durable conversation selections through `ConversationRepository` before views refresh. Providers and features may publish the change but must not rewrite cached conversations themselves.
- Environment changes that can alter model options use the same provider model-option reconciliation boundary; direct model-selector refresh is not an allowed shortcut.
- Deferred metadata with a stored model that needs fallback is withheld until `ConversationRepository` persists and adopts the replacement. Safe model-less shells may remain incrementally readable for environment-invalidation coordination; they must not expose a synthesized fallback before its write.
- A model recovered from provider-native history is availability-reconciled before its single durable write and before callers may publish it as recovered.

## Invariants

- Failed settings persistence restores the pre-mutation in-memory settings snapshot.
- A post-commit publication failure is reported as committed state; it must not roll back data that was already persisted.
- Conversation persistence for one conversation remains ordered, and stale execution snapshots must not overwrite newer provider state.
- Deletion, hydration, input-ledger, and execution-snapshot writes must preserve their ownership, generation, and binding fences. `ConversationRepository` revalidates metadata authority for staged execution immediately before provider handoff.
- Archiving clears pin state, cannot be inferred from tab closure, and never mutates provider-native history.
- Historical model recovery is best-effort, concurrency-bounded, provider-owned, and must not overwrite a model selected or recovered by a newer operation.

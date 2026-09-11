# AGENTS.md

## Project

Claudian is an Obsidian plugin that embeds provider-backed coding agents in a sidebar and inline-edit flow. Claude is the default provider. agy (Google's Antigravity CLI), Codex, Grok, OpenCode, and Pi are optional providers that plug into the same conversation model through `Conversation.providerId` and opaque provider-owned `providerState`.

Do not assume provider parity. Check each provider's `capabilities.ts`, `registration.ts`, and UI config before wiring shared behavior.

## Fork Status

This repository is a fork of `YishenTu/claudian` (remote `upstream`). It adds `src/providers/agy/` and removes Collab: `src/app/collab/`, `src/core/collab/`, `src/features/collab/`, `src/style/features/collab-*.css`, their tests, and the `@claudian-collab/protocol` dependency are all gone.

- Removing Collab is a standing decision, not unfinished porting. When reconciling with `upstream/main`, drop incoming Collab changes instead of restoring those trees. Reconsider only if this fork takes on multi-user editing, which it has no plan to.
- Fork identity lives in `manifest.json` (`id` is `claudian-agy`) and `package.json` (`name`, `description`, `author`). An upstream merge must not restore upstream's values for those fields.
- Outside `src/providers/agy/`, prefer changes that stay close to upstream. Every shared file this fork rewrites becomes a merge conflict on the next sync; `src/providers/agy/` has no upstream counterpart and never conflicts.

## Scope Guides

- Before editing a scoped area, read its nearest scoped guide:
  - `src/app/AGENTS.md`
  - `src/core/AGENTS.md`
  - `src/features/chat/AGENTS.md`
  - `src/providers/agy/AGENTS.md`
  - `src/providers/claude/AGENTS.md`
  - `src/providers/codex/AGENTS.md`
  - `src/providers/grok/AGENTS.md`
  - `src/providers/opencode/AGENTS.md`
  - `src/providers/pi/AGENTS.md`
  - `src/style/AGENTS.md`

## AGENTS.md Maintenance

- AGENTS.md is execution context for agents, not general documentation. Keep only repository- or scope-specific information that a capable agent would not reliably know; every statement must change implementation, review, or verification behavior.
- Keep repository-wide rules here; put local ownership, dependencies, invariants, failure modes, verification, and active decisions in the narrowest scoped guide that governs them.
- Do not duplicate inherited guidance or silently contradict it. State a necessary local exception and its rationale explicitly.
- Omit tours, ordinary implementation details, temporary status, and general engineering advice.
- Record a decision only when it is active, surprising from the code, expensive to reverse, and reflects a real tradeoff. State the decision, rationale, and any concrete reconsideration condition; use Git history as the archive.
- `CLAUDE.md` files should import the nearest `AGENTS.md`; do not duplicate shared guidance there.

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run lint:fix
npm run test
npm run test:watch
npm run test:coverage
```

The default full check is:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Tests mirror `src/` under `tests/unit/` and `tests/integration/`.

## Architecture

Scoped guides define the source of truth and allowed mutators for state in their area.

| Area | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle and concrete application composition |
| `src/app/` | Application conversation, settings, provider-host, and storage services |
| `src/core/` | Provider-neutral runtime, registry, storage, tool, and type contracts |
| `src/providers/acp/` | Shared ACP transport, interaction, and session primitives without provider policy |
| `src/providers/*/` | Provider adaptors, provider-owned runtime protocol, history, storage, settings, and UI |
| `src/features/chat/` | Sidebar chat orchestration against provider-neutral contracts |
| `src/features/inline-edit/` | Inline edit modal and provider-backed edit services |
| `src/features/settings/` | Shared settings shell and provider tab assembly |
| `src/shared/` | Reusable UI components |
| `src/style/` | Modular CSS built into `styles.css` |

### Dependency Direction

In the rules below, `A -> B` means `A` may import or call `B`:

```text
composition root (`src/main.ts`) -> app services + features + provider registrations + core
app services -> core contracts
features -> FeatureHost + core contracts + shared UI
providers -> ProviderHost + core contracts + shared provider and UI primitives
```

- `core/` must not import feature code, app composition, or provider implementations.
- Feature code must not import provider implementations. Resolve provider behavior through core registries and contracts.
- Provider runtime and protocol code must not import chat views, feature controllers, or other feature orchestration.
- Existing Claude compatibility re-exports that point into `src/app/` are migration seams, not an allowed general dependency direction. Do not add new provider-to-app imports; move shared contracts into `core/` when touching those seams materially.
- `src/providers/acp/` may contain protocol primitives shared by ACP providers. Provider-specific launch policy, extensions, normalization, history, and state remain in the owning provider.
- If a dependency does not fit these directions, introduce or extend an explicit contract at the owning boundary instead of reaching across layers.

### Cross-Layer Ownership

- `src/main.ts` owns plugin lifecycle and wiring; it does not become the home for feature or provider behavior.
- Complex application domains may expose one app-owned subcomposition helper, but `src/main.ts` remains the sole concrete caller and lifecycle publisher; subcomposition must not become a second root or service locator.
- `src/app/` owns application-scoped repositories, settings transactions, host adapters, and persistence coordination. See its scoped guide for exact state authority.
- `src/features/*/` owns user-facing orchestration and presentation state, not provider-native processes or storage formats.
- `src/providers/*/` owns native protocol, process, session, transcript, settings, and provider-state interpretation.
- `src/core/` owns provider-neutral contracts and shared lifecycle mechanisms, not concrete provider behavior.

Provider-specific session fields belong behind typed helpers in the owning provider directory.

## Naming Conventions

- **Symbols**: no `I` prefix on interfaces. Treat acronyms as words (`SdkSessionReadResult`), except in types mirroring an external SDK (`SDKMessage`).
- **Files**: name the file after its primary exported concept in `PascalCase.ts`; use `camelCase.ts` only for utility bags with no dominant export (when in doubt, `PascalCase`). Use `kebab-case.ts` only to mirror an external package name (`tests/__mocks__/claude-agent-sdk.ts`). Barrels stay `index.ts`, type buckets stay `types.ts`, tests mirror the source name plus `.test.ts` (qualifiers allowed: `fileLink.dom.test.ts`).
- **Folders**: `kebab-case`.
- **Imports**: no `.ts` extensions; prefer `@/` aliases over deep relative paths.

## Development Rules

- Write code, comments, identifiers, commit messages, and code blocks in English. Keep Markdown soft-wrapped (no hard-wrapped lines).
- Do not use `console.*` in production code.
- Settings writers must merge rather than replace provider-owned configuration.
- Put non-committed notes, handoff files, traces, and throwaway scripts in `.context/`.
- Production bundling Brotli-compresses `src/i18n/locales/*.json` through `scripts/compressedStaticAssets.js`, matched by a path-shaped esbuild filter. Moving or renaming that directory drops the compression silently rather than failing the build; `npm run build && npm run check:performance` catches it as a `main.js` budget breach.

## TDD Workflow

### General

- Production behavior changes and bug fixes must use TDD: establish a failing executable test at an agreed seam before implementation. Documentation-only and non-behavioral mechanical changes are exempt. When an automated failing test is not feasible, record repeatable failing evidence first and cover the closest stable seam.
- Treat documented owning-module and public interfaces as pre-agreed test seams. If behavior cannot be verified without reaching past a seam, resolve the ownership or interface decision before writing the test; do not add a test-only facade or public method.
- Build vertical tracer bullets: exercise one observable behavior at one seam with the minimum implementation needed to prove it. Do not batch a horizontal layer of tests around imagined types, collaborators, or future behavior.
- Derive expected results independently from the implementation, using a specification literal, accepted fixture, or worked example. Do not reproduce the production algorithm in the assertion, assert internal call counts, or bypass the owning interface to inspect storage unless that storage contract is the declared seam under test.
- Do not test statically defined values whose correctness is already established by their source or type declaration. Test the observable behavior that consumes them only when that behavior has meaningful regression risk.
- When logic is deleted, do not add negative tests that merely prove the removed path no longer exists. Cover only the observable replacement behavior or contract that could realistically regress.
- Mock only true external boundaries, through narrow operation-specific ports rather than a generic conditional transport. Keep owned modules real.
- After a tracer bullet is green, review and refactor its structure separately under the passing seam-level tests. Do not mix speculative architecture work into the behavior cycle.

### Project-specific

- The owner and public contracts named in the applicable scoped guides are the accepted seams for their areas.
- Captured provider-native examples are independent sources of expected behavior.
- Mock only environment, Obsidian, and provider boundaries. Keep Claudian-owned modules real. For shared provider contracts, prove provider-neutral behavior first, then cover each adapter's distinct native behavior.

## UI Semantics and Tests

- New or materially changed atomic UI actions must use native controls with explicit non-submit button types. Use a non-native interactive element only when native semantics cannot express the interaction, and then cover its accessible name, role, and complete keyboard behavior.
- At real-DOM UI seams, query actions by role and accessible name with Testing Library, retain assertions for their callback or state outcome, and use targeted jest-axe checks for deterministic component subtrees. MockElement tag or class assertions do not replace that semantic coverage.

## Provider Rules

- Prefer provider-native behavior over local reimplementation. Adapt provider output at the boundary instead of shadowing provider features.
- Keep live streaming and history replay responsibilities separate. Live output should come from the provider runtime protocol when available; provider transcript files are the replay source.
- New provider behavior must be expressed through registries and capabilities: `ProviderRegistry`, `ProviderWorkspaceRegistry`, `ProviderChatUIConfig`, provider capabilities, and provider-owned settings reconciliation.
- Model, permission, plan-mode, command, MCP, skill, and subagent behavior is provider-specific unless the core contract explicitly makes it shared.
- Treat persisted provider configuration as untrusted runtime input. Provider settings readers and storage normalization must decode every field; invalid permission, tool, and sandbox modes must fail closed.
- When provider behavior is uncertain, inspect real runtime output first. Put throwaway scripts, traces, and handoff notes in `.context/`.
- Treat provider-native history and transcripts as read-only. Never mutate or delete provider session data when a Claudian conversation changes.
- Only explicitly enabled models belong in the chat selector: no synthetic provider entries, no hidden session models, and no provider-default fallback when none are enabled.
- Runtime-discovered commands are read-only in Claudian; providers own their editing and deletion.
- Auxiliary query runners own their own process and session, independent from the chat runtime.

## Review Checks

Reviews must enforce the dependency, ownership, provider-boundary, and state-lifetime constraints above.

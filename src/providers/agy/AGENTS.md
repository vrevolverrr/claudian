# agy Provider

`src/providers/agy/` adapts Google's Antigravity CLI through `agy --print --output-format stream-json`. This provider exists only in this fork; upstream has no `src/providers/agy/`, so upstream merges never conflict here and contract drift surfaces at typecheck rather than as a merge conflict. Run `npm run typecheck` after every upstream merge before trusting a clean merge.

## Dependency Boundary

- agy is not an ACP provider. Do not route it through `src/providers/acp/`; print mode is a one-shot subprocess per turn with no session channel.
- Provider-owned conversation data stays behind `getAgyState` and `AGY_CONVERSATION_STATE_KEY`. Feature code must not inspect it.

## Ownership

| Area | Owns |
| --- | --- |
| `execution/` | Per-turn process lifecycle, permission-flag mapping, prompt assembly, run/session state |
| `runtime/` | CLI resolution, launch spec, stream parsing, prompt spill, image materialization, model discovery |
| `normalization/` | agy stream events and tool identities mapped onto Claudian's renderers |
| `prompt/` | Appendices describing what agy cannot discover about running under Claudian |
| `history/` | Claudian-owned replay; agy's own transcript is a private database this provider never reads |

## Print Mode Invariants

- One process per turn. Continuity comes from agy's conversation id, captured from the stream and replayed as `--conversation`. There is no long-lived process to hold session state.
- Print mode has no interactive channel. agy auto-denies every permission request rather than prompting, so an approval-requiring mode surfaces as failed tool steps, not as a question. `resolveAgyPermissionFlags` maps `normal` to agy's own default rather than escalating to `accept-edits`: a write is then denied and reported instead of applied unasked. Do not "fix" that by escalating.
- agy's question tool resolves as skipped without reaching the user. `AGY_NON_INTERACTIVE_APPENDIX` says so up front; without it agy spends a turn reporting the skip before restating the options as text.
- There is no stdin path, so a prompt past the argument limit is spilled to a file agy is told to read (`AgyPromptSpill`). Print mode also has no image input; attachments are written into the vault and referenced by path.
- Never pass `--effort`. agy encodes reasoning effort in the model id and rejects the flag for a model that already names its effort. `resolveAgyLaunchModel` recombines the Claudian model selection and effort setting into one id, and appends an effort only when the catalog publishes that variant.

## System Prompt Delivery

The vault system prompt rides inside the prompt text, because agy has no system-prompt flag. It is sent once, on the turn that creates the conversation; `--conversation` replays it thereafter.

Two consequences that are not visible from the call site:

- A new appendix or dynamic section reaches only conversations created after the change. Existing conversations never see it, so a prompt-delivered bug fix does not apply retroactively and a brand-new context tag is undocumented in every conversation that already exists. Prefer reusing an already-documented tag over introducing one.
- `dynamicSections` must merge the caller's sections with agy's own, never replace them. The caller's sections carry Collab's runtime endpoint; replacing them drops Collab for agy alone while every other provider keeps it.

An explicit `systemInstructions` prompt (inline edit, title generation, instruction refine) replaces the vault prompt outright and is sent every turn, because those run as their own one-shot conversations. Those paths are all `read-only` or `passive`, so agy denies writes on them regardless of what the appendices say.

## Artifacts

agy's `write_to_file` accepts an optional `ArtifactMetadata` parameter. Setting it makes agy require the target to sit inside the conversation's artifact directory (`<appDataDir>/brain/<conversation-id>/`), so a vault path fails validation with `is not a valid artifact path` while declaring permissions. A vault is nothing but user-facing markdown, so the model reaches for artifact metadata on ordinary notes unless told not to.

agy usually recovers on its own, writing the artifact into its brain directory and re-issuing the vault write without metadata, so the file does land. The turn still ends `status: ERROR` carrying that first failed step, which Claudian reports as a run error on a turn that otherwise succeeded. Claudian cannot redirect the artifact directory or suppress the check, so `AGY_NO_ARTIFACTS_APPENDIX` is the only lever. Keep its claims true: writing into the brain directory succeeds, and telling agy otherwise gives the model a rule it can watch fail.

## Context Forwarding

`buildAgyPrompt` must forward every field of `ProviderExecutionContext`. agy has silently dropped context fields twice — the editor, browser and canvas selections, then `dynamicSections` — because the fields are optional and nothing asserted on them. The `Required<ProviderExecutionContext>` literal in `tests/unit/providers/agy/agyPermissionMapping.test.ts` is the guard: a new field stops that file compiling until it is listed and asserted. Do not relax it to a partial type.

## Tool Normalization

`PARAMETER_KEY_MAP` rows are added only after observing the key on a real agy stream, never from guessing a schema. An unmapped parameter degrades to a generic tool-call render; a wrongly mapped one renders confidently wrong.

## Verification

- Behavior that is not established by agy's own documented flags must be backed by a real run. Capture `--output-format stream-json` output and read the step sequence; a step reporting `DONE` does not mean the run succeeded, and a run reporting `ERROR` does not mean nothing was written.
- Record the agy version any captured behavior came from. Provider behavior here has been verified against agy 1.1.19.
- Put raw captures and throwaway scripts in `.context/`. Never commit credentials, absolute personal paths, or raw user configuration.

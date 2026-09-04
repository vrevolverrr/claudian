# agy Provider

`src/providers/agy/` adapts Google's Antigravity CLI through `agy --input-format stream-json --output-format stream-json`. This provider exists only in this fork; upstream has no `src/providers/agy/`, so upstream merges never conflict here and contract drift surfaces at typecheck rather than as a merge conflict. Run `npm run typecheck` after every upstream merge before trusting a clean merge.

## Dependency Boundary

- agy is not an ACP provider. Do not route it through `src/providers/acp/`; agy speaks its own NDJSON stream, not ACP, and its stdin channel carries only user turns.
- Provider-owned conversation data stays behind `getAgyState` and `AGY_CONVERSATION_STATE_KEY`. Feature code must not inspect it.

## Ownership

| Area | Owns |
| --- | --- |
| `execution/` | Session process lifecycle and reuse, permission-flag mapping, prompt assembly, run/session state |
| `runtime/` | CLI resolution, launch spec, stream parsing, turn encoding, image materialization, model discovery |
| `normalization/` | agy stream events and tool identities mapped onto Claudian's renderers |
| `prompt/` | Appendices describing what agy cannot discover about running under Claudian |
| `history/` | Session-id resolution only; agy's own transcript is a private database this provider never reads. Replay comes from the Claudian-owned message transcript the conversation repository persists for `supportsNativeHistory: false` providers |

## Print Mode Invariants

- One process per session, not per turn. `--input-format stream-json` runs one turn per NDJSON line on stdin, so agy's language-server boot and `loadCodeAssist` chain are paid once. Measured on agy 1.1.19, paired on one conversation: 5.76s median per turn spawning per turn, 1.42s median reusing the process.
- `--print` takes a value, so it is passed as `--print=` and kept last in the arg vector. Given a bare `--print`, agy consumes the next flag as the prompt and exits with `--print took "--input-format" as its prompt`.
- The reuse key in `AgyExecutionSession` deliberately ignores `--conversation`. A live process already holds the conversation it created; keying on it would respawn on every turn after the first and give back the whole saving.
- `user` is the only input event agy accepts. Any other event is ignored with a warning, so stdin is not a channel for answering permission requests.
- agy exits after any errored turn, so a reused process is never left broken: a refused connection, a failed eligibility check and a print timeout each produce `result status: ERROR` followed by exit code 1, and the next turn respawns with `--conversation`. Reuse therefore needs no health check; do not add one without evidence of an error that leaves the process alive.
- A blackholed network — connection accepted, bytes dropped, as on a wifi switch or captive portal — hangs the turn for the whole `--print-timeout` before reporting `timeout waiting for response`. Measured against agy 1.1.19: a 30s flag errored at 30.1s, a 45s flag at 45.2s. `DEFAULT_PRINT_TIMEOUT` is 10m, so that is a ten-minute silent turn. Cancellation works throughout.
- Capture agy's conversation id from the init event, never only at the turn's terminal event. A first turn that is cancelled or dies before finishing otherwise leaves the conversation id unrecorded, and the next turn starts a second agy conversation while re-inlining the vault system prompt.
- Print mode has no interactive channel. agy auto-denies every permission request rather than prompting, so an approval-requiring mode surfaces as failed tool steps, not as a question. `resolveAgyPermissionFlags` maps `normal` to agy's own default rather than escalating to `accept-edits`: a write is then denied and reported instead of applied unasked. Do not "fix" that by escalating.
- agy's question tool resolves as skipped without reaching the user. `AGY_NON_INTERACTIVE_APPENDIX` says so up front; without it agy spends a turn reporting the skip before restating the options as text.
- Prompts travel on stdin, so there is no argument-size ceiling: a 405KB prompt was accepted whole. Print mode still has no image input; attachments are written into the vault and referenced by path.
- Never pass `--effort`. agy encodes reasoning effort in the model id and rejects the flag for a model that already names its effort. `resolveAgyLaunchModel` recombines the Claudian model selection and effort setting into one id, and appends an effort only when the catalog publishes that variant.
- A Claudian agy model id names a family, not an agy model: `agy:gemini-flash`, never `agy:gemini-3.8-flash`. agy serves several versions of one model at once (3.8, 3.7 and 3.6 Flash on 1.1.19) and has no alias of its own — `--model gemini-flash` fails with `model gemini-flash is not recognized`, before any network work — so `buildAgyModelFamilies` keeps only the newest version of each family and `resolveAgyLaunchModel` expands the family back to that concrete id. The point is that a stored selection survives an agy release; do not reintroduce version-bearing selection ids. `findAgyModelFamily` accepts either form, which is what migrates selections stored before the collapse.

## System Prompt Delivery

The vault system prompt rides inside the prompt text, because agy has no system-prompt flag. It is sent once, on the turn that creates the conversation; `--conversation` replays it thereafter.

Two consequences that are not visible from the call site:

- A new appendix or dynamic section reaches only conversations created after the change. Existing conversations never see it, so a prompt-delivered bug fix does not apply retroactively and a brand-new context tag is undocumented in every conversation that already exists. Prefer reusing an already-documented tag over introducing one.
- `dynamicSections` must merge the caller's sections with agy's own, never replace them. A caller that supplies sections expects them alongside agy's, not substituted.

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

/**
 * What agy needs told about running under Claudian that it cannot discover.
 *
 * agy is driven through print mode, which has no interactive channel. Its own
 * question tool resolves as skipped without ever reaching the user, and agy
 * then spends a turn reporting that the question was skipped before restating
 * the options as text. Saying so up front turns a wasted round trip into a
 * direct question the user can simply answer.
 */
export const AGY_NON_INTERACTIVE_APPENDIX = `## Asking The User

This session is not interactive. A question asked through your question tool is
discarded before the user sees it, and your permission prompts are answered
without them. Never wait on either.

When you need a decision from the user:
- Prefer stating the assumption you are making and continuing.
- If the decision genuinely blocks the work, end your turn by asking for it in
  plain text, listing the options. Their next message is the answer.`;

/**
 * Why agy must not treat a vault note as one of its artifacts.
 *
 * `write_to_file` accepts `ArtifactMetadata`, and agy then requires the target
 * to sit inside the conversation's own artifact directory. A vault is nothing
 * but user-facing markdown, so the model reaches for artifact metadata on an
 * ordinary note and agy fails the whole turn while declaring permissions:
 *
 *   ... is not a valid artifact path; artifacts must be in
 *   <appDataDir>/brain/<conversation-id>/
 *
 * Nothing on the Claudian side can recover from that: the write never runs and
 * the run ends in error. Naming the rule is the only lever available.
 */
export const AGY_NO_ARTIFACTS_APPENDIX = `## Writing Files

Every file you write here is an ordinary vault file, never one of your
artifacts. Call \`write_to_file\` with only \`TargetFile\` and \`CodeContent\`.

Never pass \`ArtifactMetadata\`, and never write into your artifact or brain
directory. Doing either fails the turn outright, because agy only accepts an
artifact path there and a vault path is not one. Report results in your reply
instead of in an artifact document.`;

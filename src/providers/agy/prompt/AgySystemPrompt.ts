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
 * ordinary note and agy fails the step while declaring permissions:
 *
 *   ... is not a valid artifact path; artifacts must be in
 *   <appDataDir>/brain/<conversation-id>/
 *
 * The step fails and nothing is written at that path. agy usually recovers on
 * its own, writing the artifact into its brain directory and re-issuing the
 * vault write without metadata, so the file does land - but the turn still
 * ends with `status: ERROR` carrying that first failed step, which Claudian
 * reports as a run error on a turn that otherwise succeeded. Claudian cannot
 * redirect the artifact directory or suppress the check, so naming the rule is
 * the only lever available.
 */
export const AGY_NO_ARTIFACTS_APPENDIX = `## Writing Files

Every file you write here is an ordinary vault file, never one of your
artifacts. Call \`write_to_file\` with only \`TargetFile\` and \`CodeContent\`.

Never pass \`ArtifactMetadata\`. A vault path is not an artifact path, so the
call fails validation and the write is lost.

Never write into your artifact or brain directory either. That write does
succeed, which is the trap: it puts the file somewhere outside the vault, where
the user cannot see it. Report results in your reply instead of in an artifact
document.`;

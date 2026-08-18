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

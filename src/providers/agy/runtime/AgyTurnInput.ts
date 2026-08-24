/**
 * Encodes one turn for `agy --input-format stream-json`, which runs a turn per
 * NDJSON line on stdin.
 *
 * The `user` event is the only input event agy accepts; anything else is
 * ignored with a warning, so there is still no channel for answering a
 * permission request.
 */
export function encodeAgyTurnInput(prompt: string): string {
  return `${JSON.stringify({
    event: 'user',
    message: { content: prompt, role: 'user' },
  })}\n`;
}

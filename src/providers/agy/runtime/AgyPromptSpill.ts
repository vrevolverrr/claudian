import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

const SPILL_DIRECTORY = path.join('.claudian', 'agy', 'prompts');

/**
 * Byte budget for the prompt argument.
 *
 * agy takes its prompt as a command-line argument and offers no stdin path, so
 * a large enough prompt fails the spawn outright with E2BIG. The kernel limit
 * covers the whole argument vector plus the environment, so this leaves most
 * of a one-megabyte ARG_MAX free for both.
 */
const MAX_PROMPT_ARGUMENT_BYTES = 256 * 1024;

export interface AgyPromptDelivery {
  /** What to pass to agy. Either the prompt itself or a pointer to it. */
  readonly prompt: string;
  /** Written file, when the prompt was too large to pass directly. */
  readonly spilledTo?: string;
}

export function promptExceedsArgumentLimit(prompt: string): boolean {
  return Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_ARGUMENT_BYTES;
}

/**
 * Passes a prompt that fits, and spills one that does not to a file inside the
 * vault, where `--add-dir` already grants access.
 *
 * A spilled prompt is a file agy chooses how to read rather than text it is
 * handed, so this runs only when the alternative is a failed spawn.
 */
export async function deliverAgyPrompt(
  prompt: string,
  vaultWorkingDirectory: string,
  turnId: string,
): Promise<AgyPromptDelivery> {
  if (!promptExceedsArgumentLimit(prompt)) {
    return { prompt };
  }

  const directory = path.join(vaultWorkingDirectory, SPILL_DIRECTORY);
  await fsp.mkdir(directory, { recursive: true });

  const file = path.join(directory, `${turnId}.md`);
  await fsp.writeFile(file, prompt, 'utf8');

  return {
    prompt: `This message was too large to send directly, so it was written to `
      + `${file}\n\nRead that file in full. It holds the user's complete message `
      + `and any instructions for this turn. Treat everything in it as if the `
      + `user had typed it to you, and answer it. Do not mention the file itself `
      + `unless the user asks about it.`,
    spilledTo: file,
  };
}

/** Ages out spilled prompts, matching how attachments are pruned. */
export async function pruneAgyPrompts(
  vaultWorkingDirectory: string,
  now: number,
  maxAgeMs: number,
): Promise<string[]> {
  const directory = path.join(vaultWorkingDirectory, SPILL_DIRECTORY);

  let entries: string[];
  try {
    entries = await fsp.readdir(directory);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry);
    try {
      const stats = await fsp.stat(file);
      if (!stats.isFile() || now - stats.mtimeMs <= maxAgeMs) continue;
      await fsp.rm(file, { force: true });
      removed.push(file);
    } catch {
      // A file that cannot be read or removed waits for the next sweep.
    }
  }

  return removed;
}

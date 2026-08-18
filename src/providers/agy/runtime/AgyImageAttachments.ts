import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';

const ATTACHMENT_DIRECTORY = path.join('.claudian', 'agy', 'attachments');

const EXTENSIONS: Readonly<Record<ImageMediaType, string>> = Object.freeze({
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export interface MaterializedAgyImages {
  readonly paths: string[];
}

/**
 * agy print mode takes no image input, but agy can read an image from disk:
 * its file viewer returns image content to the model. Attachments are
 * therefore written inside the vault, where `--add-dir` already grants access,
 * and referenced by path.
 *
 * The files outlive the turn on purpose. agy keeps the conversation in its own
 * state and re-reads the path when a later question needs a fresh look, so
 * deleting them breaks follow-ups; the name is the attachment id, so
 * re-sending the same image rewrites one file rather than adding another.
 *
 * Attachments cannot be tied to the conversation that owns them: a provider
 * session is deliberately never told its Claudian conversation identity, so
 * deletion of a conversation cannot find its files. They are aged out instead.
 */
export async function materializeAgyImages(
  attachments: readonly ImageAttachment[],
  vaultWorkingDirectory: string,
): Promise<MaterializedAgyImages> {
  if (attachments.length === 0) {
    return { paths: [] };
  }

  const directory = path.join(vaultWorkingDirectory, ATTACHMENT_DIRECTORY);
  await fsp.mkdir(directory, { recursive: true });

  const paths: string[] = [];
  for (const attachment of attachments) {
    const extension = EXTENSIONS[attachment.mediaType] ?? 'png';
    const file = path.join(directory, `${attachment.id}.${extension}`);
    await fsp.writeFile(file, Buffer.from(attachment.data, 'base64'));
    paths.push(file);
  }

  return { paths };
}

export function formatAgyImageReferences(paths: readonly string[]): string {
  if (paths.length === 0) return '';

  const list = paths.map((file) => `- ${file}`).join('\n');
  return `The user attached ${paths.length === 1 ? 'this image' : 'these images'}. `
    + `Read ${paths.length === 1 ? 'it' : 'them'} from disk before answering:\n${list}`;
}

const ATTACHMENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let prunedThisProcess = false;

/**
 * Ages out attachments once per process.
 *
 * ponytail: a time-based sweep, because the provider cannot know which
 * conversation an attachment belongs to. The window only has to outlast the
 * chance that agy re-reads the file; the image content itself already lives in
 * agy's conversation state. Tie this to conversation deletion instead if the
 * execution contract ever carries a conversation identity.
 */
export async function pruneAgyAttachmentsOnce(
  vaultWorkingDirectory: string,
  now: number,
  maxAgeMs: number = ATTACHMENT_MAX_AGE_MS,
): Promise<void> {
  if (prunedThisProcess) return;
  prunedThisProcess = true;
  await pruneAgyAttachments(vaultWorkingDirectory, now, maxAgeMs);
}

export async function pruneAgyAttachments(
  vaultWorkingDirectory: string,
  now: number,
  maxAgeMs: number = ATTACHMENT_MAX_AGE_MS,
): Promise<string[]> {
  const directory = path.join(vaultWorkingDirectory, ATTACHMENT_DIRECTORY);

  let entries: string[];
  try {
    entries = await fsp.readdir(directory);
  } catch {
    // No attachments have ever been written.
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
      // A file that cannot be read or removed is left for the next sweep.
    }
  }

  return removed;
}

/** Test seam: the once-per-process guard is module state. */
export function resetAgyAttachmentPruneGuard(): void {
  prunedThisProcess = false;
}

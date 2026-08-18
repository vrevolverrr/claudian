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
 * ponytail: nothing prunes the directory. Deleting a conversation should take
 * its attachments with it once conversation deletion has a provider hook.
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

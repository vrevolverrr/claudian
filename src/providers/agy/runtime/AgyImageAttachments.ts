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
  /** Removes the files written for one turn. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/**
 * agy print mode takes no image input, but agy can read an image from disk:
 * its file viewer returns image content to the model. Attachments are
 * therefore written inside the vault, where `--add-dir` already grants access,
 * and referenced by path.
 *
 * ponytail: files live for one turn and are deleted when it ends. An image the
 * model may want again in a later turn would need a per-conversation store
 * with its own lifetime.
 */
export async function materializeAgyImages(
  attachments: readonly ImageAttachment[],
  vaultWorkingDirectory: string,
): Promise<MaterializedAgyImages> {
  if (attachments.length === 0) {
    return { cleanup: async () => undefined, paths: [] };
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

  let cleaned = false;
  return {
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      await Promise.all(paths.map(async (file) => {
        try {
          await fsp.rm(file, { force: true });
        } catch {
          // A leftover attachment is harmless; it must not fail the turn.
        }
      }));
    },
    paths,
  };
}

export function formatAgyImageReferences(paths: readonly string[]): string {
  if (paths.length === 0) return '';

  const list = paths.map((file) => `- ${file}`).join('\n');
  return `The user attached ${paths.length === 1 ? 'this image' : 'these images'}. `
    + `Read ${paths.length === 1 ? 'it' : 'them'} from disk before answering:\n${list}`;
}

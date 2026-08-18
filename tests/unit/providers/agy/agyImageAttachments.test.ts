import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ImageAttachment } from '@/core/types';
import {
  formatAgyImageReferences,
  materializeAgyImages,
} from '@/providers/agy/runtime/AgyImageAttachments';

function makeAttachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    data: Buffer.from('not-really-an-image').toString('base64'),
    id: 'attachment-1',
    mediaType: 'image/png',
    name: 'pasted.png',
    size: 19,
    source: 'paste',
    ...overrides,
  };
}

describe('materializeAgyImages', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-vault-'));
  });

  afterEach(async () => {
    await fsp.rm(vault, { force: true, recursive: true });
  });

  it('writes attachments inside the vault so --add-dir already covers them', async () => {
    const images = await materializeAgyImages([makeAttachment()], vault);

    expect(images.paths).toHaveLength(1);
    expect(images.paths[0].startsWith(vault)).toBe(true);
    expect(images.paths[0].endsWith(path.join('.claudian', 'agy', 'attachments', 'attachment-1.png')))
      .toBe(true);
    await expect(fsp.readFile(images.paths[0], 'utf8')).resolves.toBe('not-really-an-image');
  });

  it('picks the extension from the media type', async () => {
    const images = await materializeAgyImages(
      [makeAttachment({ id: 'a', mediaType: 'image/jpeg' })],
      vault,
    );

    expect(images.paths[0].endsWith('a.jpg')).toBe(true);
  });

  it('removes the files when the turn ends, idempotently', async () => {
    const images = await materializeAgyImages([makeAttachment()], vault);

    await images.cleanup();
    await expect(fsp.access(images.paths[0])).rejects.toThrow();
    await expect(images.cleanup()).resolves.toBeUndefined();
  });

  it('touches the filesystem only when something is attached', async () => {
    const images = await materializeAgyImages([], vault);

    expect(images.paths).toEqual([]);
    await expect(fsp.access(path.join(vault, '.claudian'))).rejects.toThrow();
  });
});

describe('formatAgyImageReferences', () => {
  it('says nothing when there is nothing attached', () => {
    expect(formatAgyImageReferences([])).toBe('');
  });

  it('lists every path and reads naturally for one or many', () => {
    expect(formatAgyImageReferences(['/vault/a.png'])).toContain('this image');
    expect(formatAgyImageReferences(['/vault/a.png'])).toContain('- /vault/a.png');

    const many = formatAgyImageReferences(['/vault/a.png', '/vault/b.png']);
    expect(many).toContain('these images');
    expect(many).toContain('- /vault/b.png');
  });
});

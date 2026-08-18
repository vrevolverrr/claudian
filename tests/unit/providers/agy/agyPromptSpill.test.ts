import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  deliverAgyPrompt,
  promptExceedsArgumentLimit,
  pruneAgyPrompts,
} from '@/providers/agy/runtime/AgyPromptSpill';

describe('deliverAgyPrompt', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-spill-'));
  });

  afterEach(async () => {
    await fsp.rm(vault, { force: true, recursive: true });
  });

  it('passes an ordinary prompt through untouched', async () => {
    const delivery = await deliverAgyPrompt('summarize my notes', vault, 'turn-1');

    expect(delivery.prompt).toBe('summarize my notes');
    expect(delivery.spilledTo).toBeUndefined();
    // Nothing is written for a prompt that fits.
    await expect(fsp.access(path.join(vault, '.claudian'))).rejects.toThrow();
  });

  it('measures the limit in bytes, not characters', () => {
    // Four bytes per emoji: a prompt of 100k emoji is 400KB.
    expect(promptExceedsArgumentLimit('a'.repeat(100_000))).toBe(false);
    expect(promptExceedsArgumentLimit('🙂'.repeat(100_000))).toBe(true);
  });

  it('spills an oversized prompt and points agy at the file', async () => {
    const huge = 'x'.repeat(300 * 1024);
    const delivery = await deliverAgyPrompt(huge, vault, 'turn-2');

    expect(delivery.spilledTo).toBe(
      path.join(vault, '.claudian', 'agy', 'prompts', 'turn-2.md'),
    );
    await expect(fsp.readFile(delivery.spilledTo!, 'utf8')).resolves.toBe(huge);

    // What agy receives must stay small and must name the file.
    expect(promptExceedsArgumentLimit(delivery.prompt)).toBe(false);
    expect(delivery.prompt).toContain(delivery.spilledTo!);
    expect(delivery.prompt).toContain('Read that file in full');
  });
});

describe('pruneAgyPrompts', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('ages out spilled prompts and leaves recent ones', async () => {
    const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-spill-prune-'));
    const now = Date.UTC(2026, 7, 18);

    const stale = await deliverAgyPrompt('x'.repeat(300 * 1024), vault, 'old');
    const fresh = await deliverAgyPrompt('y'.repeat(300 * 1024), vault, 'new');
    const stamp = new Date(now - 40 * DAY);
    await fsp.utimes(stale.spilledTo!, stamp, stamp);

    await expect(pruneAgyPrompts(vault, now, 30 * DAY)).resolves.toEqual([stale.spilledTo]);
    await expect(fsp.access(fresh.spilledTo!)).resolves.toBeUndefined();
    await fsp.rm(vault, { force: true, recursive: true });
  });

  it('is a no-op when nothing was ever spilled', async () => {
    const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-spill-empty-'));
    await expect(pruneAgyPrompts(vault, Date.now(), DAY)).resolves.toEqual([]);
    await fsp.rm(vault, { force: true, recursive: true });
  });
});

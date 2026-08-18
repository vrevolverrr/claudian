export type AgyJsonlLineHandler = (line: string) => void;

interface JsonlReadableStream {
  off(eventName: 'data', listener: (chunk: Buffer | string) => void): unknown;
  off(eventName: 'end' | 'close', listener: () => void): unknown;
  on(eventName: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(eventName: 'end' | 'close', listener: () => void): unknown;
}

/**
 * Splits a byte stream into newline-delimited records.
 *
 * agy flushes one JSON object per line but not one line per chunk, so records
 * are reassembled here and the trailing partial line is delivered on end.
 */
export function subscribeAgyJsonlLines(
  input: JsonlReadableStream,
  onLine: AgyJsonlLineHandler,
  onEnd?: () => void,
): () => void {
  let buffer = '';

  const handleData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    for (;;) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) break;

      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) onLine(line);
    }
  };

  const handleEnd = (): void => {
    const remainder = buffer;
    buffer = '';
    if (remainder.trim().length > 0) onLine(remainder);
    onEnd?.();
  };

  input.on('data', handleData);
  input.on('end', handleEnd);

  return () => {
    input.off('data', handleData);
    input.off('end', handleEnd);
  };
}

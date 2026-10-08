/**
 * The part of the R2 bucket API the app uses (put / get with range / delete), on a local directory:
 * <dir>/<key> holds the bytes, <dir>/<key>.meta.json the content type and custom metadata.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

interface Meta { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }

export function diskBucket(dir: string) {
  const base = path.resolve(dir);
  const at = (key: string) => {
    const full = path.resolve(base, key);
    if (!full.startsWith(base + path.sep) || key.endsWith('.meta.json')) throw new Error(`invalid media key: ${key}`);
    return full;
  };

  return {
    async put(key: string, value: ArrayBuffer | ArrayBufferView | string, options: Meta = {}) {
      const file = at(key);
      await mkdir(path.dirname(file), { recursive: true });
      const bytes = typeof value === 'string' ? Buffer.from(value)
        : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
      await writeFile(file, bytes);
      await writeFile(file + '.meta.json', JSON.stringify({ httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {} }));
      return { key, size: bytes.length };
    },

    async get(key: string, options: { range?: { offset?: number; length?: number } } = {}) {
      const file = at(key);
      let size: number;
      try { size = (await stat(file)).size; } catch { return null; }
      const meta: Meta = JSON.parse(await readFile(file + '.meta.json', 'utf8').catch(() => '{}'));
      const offset = Math.min(Math.max(options.range?.offset ?? 0, 0), size);
      const length = Math.min(options.range?.length ?? size - offset, size - offset);
      const stream = length > 0 ? createReadStream(file, { start: offset, end: offset + length - 1 }) : Readable.from([]);
      return {
        key, size, httpMetadata: meta.httpMetadata ?? {}, customMetadata: meta.customMetadata ?? {},
        range: options.range ? { offset, length } : undefined,
        body: Readable.toWeb(stream) as unknown as ReadableStream,
      };
    },

    async delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) {
        const file = at(k);
        await rm(file, { force: true });
        await rm(file + '.meta.json', { force: true });
      }
    },
  };
}

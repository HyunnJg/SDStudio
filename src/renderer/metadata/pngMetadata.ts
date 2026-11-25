/* eslint no-void: off, no-bitwise: off, no-await-in-loop: off, no-restricted-syntax: off -- Bounded binary/stream decoding. */
import crc32 from '../../pngCRC';

export const PNG_IMPORT_LIMITS = {
  bytes: 32 * 1024 * 1024,
  pixels: 16 * 1024 * 1024,
  metadata: 512 * 1024,
  chunks: 4096,
} as const;
export class PNGMetadataError extends Error {
  constructor(
    readonly code:
      'PNG_INPUT' | 'PNG_LIMIT' | 'PNG_METADATA' | 'PNG_MISSING' | 'CANCELLED',
  ) {
    super(code);
  }
}
const check = (
  ok: boolean,
  code: 'PNG_INPUT' | 'PNG_LIMIT' | 'PNG_METADATA' = 'PNG_INPUT',
) => {
  if (!ok) throw new PNGMetadataError(code);
};
const guard = (signal: AbortSignal) => {
  if (signal.aborted) throw new PNGMetadataError('CANCELLED');
};
const utf8 = (bytes: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const latinText = (bytes: Uint8Array) => {
  try {
    return utf8(bytes);
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export async function decompressMetadata(
  bytes: Uint8Array,
  format: 'gzip' | 'deflate',
  signal: AbortSignal,
): Promise<Uint8Array> {
  guard(signal);
  check(bytes.length <= PNG_IMPORT_LIMITS.metadata, 'PNG_LIMIT');
  let inputOffset = 0;
  // eslint-disable-next-line no-undef -- DOM BufferSource is a type required by DecompressionStream.
  const input = new ReadableStream<BufferSource>({
    pull(controller) {
      if (inputOffset === bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, inputOffset + 1024);
      controller.enqueue(Uint8Array.from(bytes.subarray(inputOffset, end)));
      inputOffset = end;
    },
  });
  const reader = input.pipeThrough(new DecompressionStream(format)).getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let finished = false;
    while (!finished) {
      guard(signal);
      const next = await reader.read();
      guard(signal);
      if (next.done) {
        finished = true;
        break;
      }
      size += next.value.length;
      check(size <= PNG_IMPORT_LIMITS.metadata, 'PNG_LIMIT');
      chunks.push(next.value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
export interface PNGFrame {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  texts: { type: string; bytes: Uint8Array }[];
}
export function inspectPNG(bytes: Uint8Array): PNGFrame {
  check(bytes.length <= PNG_IMPORT_LIMITS.bytes, 'PNG_LIMIT');
  check(
    bytes.length >= 45 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let count = 0;
  let ended = false;
  let idat = false;
  let textSize = 0;
  const frame: PNGFrame = {
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: 0,
    texts: [],
  };
  while (offset < bytes.length) {
    count += 1;
    check(count <= PNG_IMPORT_LIMITS.chunks, 'PNG_LIMIT');
    check(offset + 12 <= bytes.length);
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    check(end <= bytes.length);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    check(/^[A-Za-z]{4}$/.test(type));
    check(
      crc32(bytes.subarray(offset + 4, end - 4)) === view.getUint32(end - 4),
    );
    const data = bytes.subarray(offset + 8, end - 4);
    if (count === 1) {
      check(type === 'IHDR' && length === 13);
      frame.width = view.getUint32(offset + 8);
      frame.height = view.getUint32(offset + 12);
      [, , , , , , , , frame.bitDepth, frame.colorType] = data;
      check(frame.width > 0 && frame.height > 0);
      check(
        frame.width * frame.height <= PNG_IMPORT_LIMITS.pixels,
        'PNG_LIMIT',
      );
    } else check(type !== 'IHDR');
    if (type === 'IDAT') idat = true;
    if (['tEXt', 'iTXt', 'zTXt'].includes(type)) {
      textSize += length;
      check(textSize <= PNG_IMPORT_LIMITS.metadata, 'PNG_LIMIT');
      frame.texts.push({ type, bytes: data });
    }
    offset = end;
    if (type === 'IEND') {
      check(length === 0 && idat && offset === bytes.length);
      ended = true;
      break;
    }
  }
  check(ended);
  return frame;
}
async function textChunk(
  type: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<[string, string] | undefined> {
  const zero = bytes.indexOf(0);
  check(zero >= 1 && zero <= 79, 'PNG_METADATA');
  const keyword = latinText(bytes.subarray(0, zero));
  if (!['Comment', 'Source', 'Software', 'Description'].includes(keyword))
    return undefined;
  let data = bytes.subarray(zero + 1);
  if (type === 'zTXt') {
    check(data[0] === 0, 'PNG_METADATA');
    data = await decompressMetadata(data.subarray(1), 'deflate', signal);
  }
  if (type === 'iTXt') {
    check((data[0] === 0 || data[0] === 1) && data[1] === 0, 'PNG_METADATA');
    const compressed = data[0] === 1;
    const language = data.indexOf(0, 2);
    check(language >= 2, 'PNG_METADATA');
    const translated = data.indexOf(0, language + 1);
    check(translated >= language + 1, 'PNG_METADATA');
    data = data.subarray(translated + 1);
    if (compressed) data = await decompressMetadata(data, 'deflate', signal);
  }
  return [keyword, type === 'iTXt' ? utf8(data) : latinText(data)];
}
interface ParsedMetadata {
  comment: Record<string, unknown>;
  description?: unknown;
  sourceLabel?: unknown;
}
function unpack(value: Record<string, unknown>): ParsedMetadata | undefined {
  let comment: unknown = value.Comment;
  if (typeof comment === 'string') {
    check(comment.length <= PNG_IMPORT_LIMITS.metadata, 'PNG_LIMIT');
    comment = JSON.parse(comment);
  }
  if (!object(comment)) return undefined;
  return { comment, description: value.Description, sourceLabel: value.Source };
}
export interface DecodedPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export async function readAlphaMetadata(
  pixels: DecodedPixels,
  signal: AbortSignal,
): Promise<ParsedMetadata | undefined> {
  const { width, height, data } = pixels;
  check(
    Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0,
  );
  check(width * height <= PNG_IMPORT_LIMITS.pixels, 'PNG_LIMIT');
  check(data.length === width * height * 4);
  let bit = 0;
  const byte = () => {
    let value = 0;
    for (let i = 0; i < 8; i += 1) {
      check(bit < width * height, 'PNG_METADATA');
      const x = Math.floor(bit / height);
      const y = bit % height;
      value = (value << 1) | (data[(y * width + x) * 4 + 3] & 1);
      bit += 1;
    }
    return value;
  };
  const signature = 'stealth_pngcomp';
  if (width * height < (signature.length + 4) * 8) return undefined;
  const magic = String.fromCharCode(
    ...Array.from({ length: signature.length }, byte),
  );
  // Protocol reference: NovelAI/nai_meta.py. Alpha only, column-major, MSB first.
  if (magic !== signature) return undefined;
  const bits = byte() * 16777216 + byte() * 65536 + byte() * 256 + byte();
  check(bits % 8 === 0 && bits > 0, 'PNG_METADATA');
  check(bits / 8 <= PNG_IMPORT_LIMITS.metadata, 'PNG_LIMIT');
  check(bits <= width * height - bit, 'PNG_METADATA');
  guard(signal);
  const compressed = Uint8Array.from({ length: bits / 8 }, byte);
  const value = JSON.parse(
    utf8(await decompressMetadata(compressed, 'gzip', signal)),
  );
  check(object(value), 'PNG_METADATA');
  return unpack(value);
}
export async function decodePixels(
  bytes: Uint8Array,
  signal: AbortSignal,
  mime = 'image/png',
): Promise<DecodedPixels> {
  const bitmap = await createImageBitmap(
    new Blob([Uint8Array.from(bytes)], { type: mime }),
    { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
  );
  try {
    guard(signal);
    check(
      bitmap.width * bitmap.height <= PNG_IMPORT_LIMITS.pixels,
      'PNG_LIMIT',
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    check(!!context);
    context!.drawImage(bitmap, 0, 0);
    return context!.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
export interface PNGMetadata {
  comment: Record<string, unknown>;
  description?: unknown;
  sourceLabel?: unknown;
  source: 'text' | 'alpha' | 'embedded';
  width: number;
  height: number;
}
export async function readPNGMetadata(
  bytes: Uint8Array,
  signal = new AbortController().signal,
  decode = decodePixels,
): Promise<PNGMetadata> {
  try {
    guard(signal);
    const frame = inspectPNG(bytes);
    const fields: Record<string, string> = Object.create(null);
    let size = 0;
    for (const chunk of frame.texts) {
      const entry = await textChunk(chunk.type, chunk.bytes, signal);
      guard(signal);
      if (entry) {
        const [key, value] = entry;
        check(!Object.hasOwn(fields, key), 'PNG_METADATA');
        size += value.length;
        check(size <= PNG_IMPORT_LIMITS.metadata, 'PNG_LIMIT');
        fields[key] = value;
      }
    }
    let text: ParsedMetadata | undefined;
    try {
      text = unpack(fields);
    } catch {
      /* A valid alpha copy may still be readable. */
    }
    if (text)
      return {
        ...text,
        width: frame.width,
        height: frame.height,
        source: 'text',
      };
    if (frame.colorType === 6 && frame.bitDepth === 8) {
      const pixels = await decode(bytes, signal);
      guard(signal);
      check(pixels.width === frame.width && pixels.height === frame.height);
      const alpha = await readAlphaMetadata(pixels, signal);
      guard(signal);
      if (alpha)
        return {
          ...alpha,
          width: frame.width,
          height: frame.height,
          source: 'alpha',
        };
    }
    throw new PNGMetadataError('PNG_MISSING');
  } catch (error) {
    guard(signal);
    if (error instanceof PNGMetadataError) throw error;
    throw new PNGMetadataError('PNG_METADATA');
  }
}

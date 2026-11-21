/* eslint no-bitwise: off -- CRC32 and ZIP bit flags require bit operations. */
import { createInflateRaw } from 'zlib';
import { NaiError } from './errors';
import type { ImageResponseReason } from './responseReasons';

// Local single-sample policy. These are resource bounds, not NovelAI server limits.
export const IMAGE_RESPONSE_LIMITS = {
  zipBytes: 64 * 1024 * 1024,
  pngBytes: 32 * 1024 * 1024,
  pixels: 16 * 1024 * 1024,
} as const;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: ArrayLike<number>, previous = 0): number {
  let crc = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1)
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(reason: ImageResponseReason): never {
  throw new NaiError('INVALID_IMAGE_RESPONSE', false, undefined, reason);
}
function check(condition: boolean, reason: ImageResponseReason): void {
  if (!condition) invalid(reason);
}

function checkExtra(bytes: Buffer, start: number, length: number): void {
  const end = start + length;
  let offset = start;
  while (offset < end) {
    check(offset + 4 <= end, 'zip-extra');
    check(bytes.readUInt16LE(offset) !== 1, 'zip64'); // ZIP64 is outside this response profile.
    offset += 4 + bytes.readUInt16LE(offset + 2);
    check(offset <= end, 'zip-extra');
  }
}

// A deliberately narrow ZIP profile: one PNG, STORE/DEFLATE, no ZIP64,
// encryption, split volumes, prefixes, extra entries or filesystem extraction.
function entry(bytes: Buffer) {
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65557);
    i -= 1
  ) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  check(end >= 0, 'zip-eocd');
  check(
    bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0,
    'zip-volume',
  );
  check(
    bytes.readUInt16LE(end + 8) === 1 && bytes.readUInt16LE(end + 10) === 1,
    'zip-entry-count',
  );
  const length = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  check(
    start + length === end && length >= 46 && start + 46 <= end,
    'zip-central',
  );
  check(bytes.readUInt32LE(start) === 0x02014b50, 'zip-central');
  const flags = bytes.readUInt16LE(start + 8);
  const method = bytes.readUInt16LE(start + 10);
  const crc = bytes.readUInt32LE(start + 16);
  const compressed = bytes.readUInt32LE(start + 20);
  const size = bytes.readUInt32LE(start + 24);
  const nameLength = bytes.readUInt16LE(start + 28);
  const extraLength = bytes.readUInt16LE(start + 30);
  const commentLength = bytes.readUInt16LE(start + 32);
  // UTF-8, data descriptors and DEFLATE compression hints only.
  check((flags & ~0x080e) === 0, 'zip-flags');
  check(method === 0 || method === 8, 'zip-method');
  check(method !== 0 || (flags & 6) === 0, 'zip-flags');
  check(bytes.readUInt16LE(start + 34) === 0, 'zip-volume'); // same volume
  check(bytes.readUInt32LE(start + 42) === 0, 'zip-prefix'); // no prefixed/self-extracting data
  check(
    ((bytes.readUInt32LE(start + 38) >>> 16) & 0xf000) !== 0xa000,
    'zip-symlink',
  ); // no symlink
  check(
    46 + nameLength + extraLength + commentLength === length,
    'zip-central',
  );
  check(
    size > 0 &&
      size !== 0xffffffff &&
      compressed > 0 &&
      compressed !== 0xffffffff,
    'zip-size',
  );
  if (size > IMAGE_RESPONSE_LIMITS.pngBytes)
    throw new NaiError(
      'RESPONSE_TOO_LARGE',
      false,
      undefined,
      'response-expanded-limit',
    );
  checkExtra(bytes, start + 46 + nameLength, extraLength);
  const name = bytes.subarray(start + 46, start + 46 + nameLength);
  const text = name.toString('utf8');
  // ASCII relative names avoid encoding ambiguity and JSZip-style path repair.
  check(nameLength <= 255 && /^[A-Za-z0-9_./-]+\.png$/i.test(text), 'zip-name');
  check(
    !text.startsWith('/') &&
      text.split('/').every((p) => p !== '' && p !== '.' && p !== '..'),
    'zip-name',
  );
  check(bytes.readUInt32LE(0) === 0x04034b50, 'zip-local');
  check(
    bytes.readUInt16LE(6) === flags && bytes.readUInt16LE(8) === method,
    'zip-local',
  );
  const localName = bytes.readUInt16LE(26);
  const localExtra = bytes.readUInt16LE(28);
  const payloadStart = 30 + localName + localExtra;
  check(localName === nameLength && payloadStart <= start, 'zip-local');
  check(
    bytes.subarray(30, 30 + localName).equals(Uint8Array.from(name)),
    'zip-local',
  );
  check(payloadStart + compressed <= start, 'zip-local');
  checkExtra(bytes, 30 + localName, localExtra);
  if (!(flags & 8)) {
    check(
      bytes.readUInt32LE(14) === crc &&
        bytes.readUInt32LE(18) === compressed &&
        bytes.readUInt32LE(22) === size,
      'zip-local',
    );
    check(payloadStart + compressed === start, 'zip-local');
  } else {
    // Streaming ZIPs may put CRC/sizes in a signed or unsigned data descriptor.
    let descriptor = payloadStart + compressed;
    if (
      descriptor + 16 === start &&
      bytes.readUInt32LE(descriptor) === 0x08074b50
    )
      descriptor += 4;
    check(descriptor + 12 === start, 'zip-descriptor');
    check(
      bytes.readUInt32LE(descriptor) === crc &&
        bytes.readUInt32LE(descriptor + 4) === compressed &&
        bytes.readUInt32LE(descriptor + 8) === size,
      'zip-descriptor',
    );
    [
      [14, crc],
      [18, compressed],
      [22, size],
    ].forEach(([offset, value]) => {
      check(
        bytes.readUInt32LE(offset) === 0 ||
          bytes.readUInt32LE(offset) === value,
        'zip-local',
      );
    });
  }
  if (method === 0) check(compressed === size, 'zip-size');
  return {
    payload: bytes.subarray(payloadStart, payloadStart + compressed),
    method,
    size,
    crc,
  };
}

function checkPNG(bytes: Buffer): void {
  check(
    bytes
      .subarray(0, 8)
      .equals(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'png-signature',
  );
  let offset = 8;
  let imageData = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    check(end <= bytes.length, 'png-chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    check(
      bytes
        .subarray(offset + 4, offset + 8)
        .every(
          (byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122),
        ),
      'png-chunk',
    );
    check(
      crc32(bytes.subarray(offset + 4, end - 4)) ===
        bytes.readUInt32BE(end - 4),
      'png-crc',
    );
    if (offset === 8) {
      check(type === 'IHDR' && size === 13, 'png-ihdr');
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (width * height > IMAGE_RESPONSE_LIMITS.pixels)
        throw new NaiError(
          'RESPONSE_TOO_LARGE',
          false,
          undefined,
          'png-pixel-limit',
        );
      check(width > 0 && height > 0, 'png-ihdr');
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      check(
        depths[bytes[offset + 17]]?.includes(bytes[offset + 16]) === true,
        'png-format',
      );
      check(
        bytes[offset + 18] === 0 &&
          bytes[offset + 19] === 0 &&
          bytes[offset + 20] <= 1,
        'png-format',
      );
    } else check(type !== 'IHDR', 'png-ihdr');
    if (type === 'IDAT') imageData = true;
    if (type === 'IEND') {
      check(size === 0, 'png-iend');
      check(imageData, 'png-idat');
      check(end === bytes.length, 'png-trailing');
      ended = true;
      break;
    }
    offset = end;
  }
  check(ended, 'png-iend');
}

export async function readNaiImageResponse(
  input: Uint8Array,
  signal?: AbortSignal,
  timeoutMs = 10000,
): Promise<Uint8Array> {
  const deadline = performance.now() + timeoutMs;
  const guard = () => {
    if (signal?.aborted)
      throw new NaiError('CANCELLED', false, undefined, 'response-cancelled');
    if (performance.now() >= deadline)
      throw new NaiError('TIMEOUT', false, undefined, 'response-deadline');
  };
  try {
    guard();
    check(
      input instanceof Uint8Array &&
        Number.isFinite(timeoutMs) &&
        timeoutMs > 0 &&
        timeoutMs <= 180000,
      'response-input',
    );
    if (input.byteLength > IMAGE_RESPONSE_LIMITS.zipBytes)
      throw new NaiError(
        'RESPONSE_TOO_LARGE',
        false,
        undefined,
        'response-compressed-limit',
      );
    // Snapshot caller-owned memory before asynchronous decompression.
    const archive = Buffer.from(input);
    const image = entry(archive);
    guard();
    let bytes: Buffer;
    if (image.method === 0) bytes = image.payload;
    else
      bytes = await new Promise<Buffer>((resolve, reject) => {
        const inflater = createInflateRaw({ chunkSize: 16384 });
        const chunks: Uint8Array[] = [];
        let total = 0;
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        let abort: () => void;
        const finish = (error?: NaiError) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (error) {
            chunks.length = 0;
            inflater.destroy();
            reject(error);
          } else resolve(Buffer.concat(chunks, total));
        };
        abort = () =>
          finish(
            new NaiError('CANCELLED', false, undefined, 'response-cancelled'),
          );
        timer = setTimeout(
          () =>
            finish(
              new NaiError('TIMEOUT', false, undefined, 'response-deadline'),
            ),
          Math.max(1, deadline - performance.now()),
        );
        signal?.addEventListener('abort', abort, { once: true });
        inflater.on('error', () =>
          finish(
            new NaiError(
              'INVALID_IMAGE_RESPONSE',
              false,
              undefined,
              'zip-inflate',
            ),
          ),
        );
        inflater.on('data', (chunk: Buffer) => {
          if (settled) return;
          try {
            guard();
            total += chunk.length;
            if (total > IMAGE_RESPONSE_LIMITS.pngBytes)
              throw new NaiError(
                'RESPONSE_TOO_LARGE',
                false,
                undefined,
                'response-expanded-limit',
              );
            if (total > image.size) invalid('zip-expanded-size');
            chunks.push(
              new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
            );
          } catch (error) {
            finish(
              error instanceof NaiError
                ? error
                : new NaiError(
                    'INVALID_IMAGE_RESPONSE',
                    false,
                    undefined,
                    'response-internal',
                  ),
            );
          }
        });
        inflater.on('end', () => {
          if (total !== image.size)
            finish(
              new NaiError(
                'INVALID_IMAGE_RESPONSE',
                false,
                undefined,
                'zip-expanded-size',
              ),
            );
          else if (inflater.bytesWritten !== image.payload.length)
            finish(
              new NaiError(
                'INVALID_IMAGE_RESPONSE',
                false,
                undefined,
                'zip-deflate-trailing',
              ),
            );
          else finish();
        });
        inflater.end(image.payload);
      });
    guard();
    check(bytes.length === image.size, 'zip-expanded-size');
    check(crc32(bytes) === image.crc, 'zip-crc');
    checkPNG(bytes);
    guard();
    return image.method === 0
      ? Uint8Array.from(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength); // Original PNG bytes, including metadata/alpha. Never re-encode.
  } catch (error) {
    throw error instanceof NaiError
      ? error
      : new NaiError(
          'INVALID_IMAGE_RESPONSE',
          false,
          undefined,
          'response-internal',
        );
  }
}

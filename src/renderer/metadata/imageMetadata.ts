/* eslint no-bitwise: off, no-continue: off, no-restricted-syntax: off -- Skip standalone markers and stop at the first recognized record. */
import ExifReader from 'exifreader';
import { imageFormat } from '../../workspaceReference';
import {
  PNG_IMPORT_LIMITS,
  PNGMetadataError,
  readPNGMetadata,
  readAlphaMetadata,
  decodePixels,
} from './pngMetadata';
import type { PNGMetadata } from './pngMetadata';

// Bound metadata before passing the container to the EXIF/XMP decoder. Image payloads are skipped.
function inspectHeaders(bytes: Uint8Array, format: 'jpeg' | 'webp') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const comments: string[] = [];
  let alphaSize: { width: number; height: number } | undefined;
  let animated = false;
  let total = 0;
  const count = (length: number) => {
    total += length;
    if (total > PNG_IMPORT_LIMITS.metadata)
      throw new PNGMetadataError('PNG_LIMIT');
  };
  let offset = format === 'webp' ? 12 : 2;
  if (format === 'webp' && view.getUint32(4, true) + 8 !== bytes.length)
    throw new PNGMetadataError('PNG_INPUT');
  for (let chunks = 0; offset < bytes.length; chunks += 1) {
    if (chunks >= PNG_IMPORT_LIMITS.chunks)
      throw new PNGMetadataError('PNG_LIMIT');
    if (format === 'webp') {
      const name = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      offset += 8 + length + (length % 2);
      if (offset > bytes.length) throw new PNGMetadataError('PNG_INPUT');
      if (name === 'ANIM') animated = true;
      if (name === 'VP8X' && length === 10 && bytes[start] & 16) {
        const dimension = (i: number) =>
          1 + bytes[i] + 256 * bytes[i + 1] + 65536 * bytes[i + 2];
        alphaSize = {
          width: dimension(start + 4),
          height: dimension(start + 7),
        };
      }
      if (name === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        if (bits & 0x10000000)
          alphaSize = {
            width: 1 + (bits & 0x3fff),
            height: 1 + ((bits >>> 14) & 0x3fff),
          };
      }
      if (name === 'EXIF' || name === 'XMP ') count(length);
    } else {
      if (bytes[offset] !== 255) throw new PNGMetadataError('PNG_INPUT');
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xda || marker === 0xd9) break;
      // TEM is standalone; restart markers only occur in entropy-coded data.
      if (marker === 1) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length)
        throw new PNGMetadataError('PNG_INPUT');
      if (marker === 0xe1 || marker === 0xfe) count(length - 2);
      if (marker === 0xfe)
        comments.push(
          new TextDecoder().decode(bytes.subarray(offset + 2, offset + length)),
        );
      offset += length;
    }
  }
  return { comments, alphaSize: animated ? undefined : alphaSize };
}

function generationFields(text: string) {
  if (!text.trimStart().startsWith('{')) return undefined;
  try {
    const outer = JSON.parse(text);
    const comment =
      typeof outer.Comment === 'string'
        ? JSON.parse(outer.Comment)
        : (outer.Comment ?? outer);
    if (!comment || typeof comment !== 'object' || Array.isArray(comment))
      return undefined;
    if (
      ![
        'prompt',
        'uc',
        'negative_prompt',
        'v4_prompt',
        'v4_negative_prompt',
        'seed',
        'steps',
        'scale',
      ].some((key) => Object.hasOwn(comment, key))
    )
      return undefined;
    return {
      comment,
      description: outer.Description,
      sourceLabel: outer.Source,
    };
  } catch {
    return undefined;
  }
}

export default async function readImageMetadata(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<PNGMetadata> {
  if (signal.aborted) throw new PNGMetadataError('CANCELLED');
  if (bytes.length > PNG_IMPORT_LIMITS.bytes)
    throw new PNGMetadataError('PNG_LIMIT');
  const format = imageFormat(bytes);
  if (format === 'png') return readPNGMetadata(bytes, signal);
  if (!format) throw new PNGMetadataError('PNG_INPUT');
  try {
    const { comments, alphaSize } = inspectHeaders(bytes, format);
    const tags = ExifReader.load(bytes, {
      expanded: true,
      includeTags: {
        exif: ['UserComment', 'ImageDescription'],
        xmp: ['description', 'Comment', 'UserComment'],
        file: ['Image Width', 'Image Height'],
        riff: ['ImageWidth', 'ImageHeight'],
      },
    });
    const dimensions =
      format === 'webp'
        ? [tags.riff?.ImageWidth?.value, tags.riff?.ImageHeight?.value]
        : [
            tags.file?.['Image Width']?.value,
            tags.file?.['Image Height']?.value,
          ];
    const [width, height] = dimensions.map(Number);
    if (width * height > PNG_IMPORT_LIMITS.pixels)
      throw new PNGMetadataError('PNG_LIMIT');
    const candidates: unknown[] = [
      tags.exif?.UserComment,
      tags.exif?.ImageDescription,
      tags.xmp?.Comment,
      tags.xmp?.UserComment,
      tags.xmp?.description,
    ];
    const userComment = tags.exif?.UserComment;
    if (
      userComment &&
      typeof userComment === 'object' &&
      'value' in userComment &&
      Array.isArray(userComment.value) &&
      userComment.value.length >= 8
    ) {
      const raw = Uint8Array.from(userComment.value);
      const header = String.fromCharCode(...raw.subarray(0, 8));
      const body = raw.subarray(8);
      if (header === 'UNICODE\0' || header === 'ASCII\0\0\0') {
        let encoding = 'utf-8';
        if (header === 'UNICODE\0') {
          encoding =
            body[0] === 0xfe || body[0] === 0 ? 'utf-16be' : 'utf-16le';
        }
        comments.push(
          new TextDecoder(encoding).decode(body).replace(/\0+$/, ''),
        );
      }
    }
    for (const tag of candidates) {
      if (
        tag &&
        typeof tag === 'object' &&
        'description' in tag &&
        typeof tag.description === 'string'
      )
        comments.push(tag.description);
    }
    for (const text of comments) {
      const fields = generationFields(text);
      if (fields) {
        if (!(width > 0 && height > 0)) throw new PNGMetadataError('PNG_INPUT');
        return { ...fields, width, height, source: 'embedded' };
      }
    }
    if (alphaSize) {
      if (alphaSize.width * alphaSize.height > PNG_IMPORT_LIMITS.pixels)
        throw new PNGMetadataError('PNG_LIMIT');
      const pixels = await decodePixels(bytes, signal, 'image/webp');
      if (
        pixels.width !== alphaSize.width ||
        pixels.height !== alphaSize.height
      )
        throw new PNGMetadataError('PNG_INPUT');
      const fields = await readAlphaMetadata(pixels, signal);
      if (fields) return { ...fields, ...alphaSize, source: 'alpha' };
    }
    throw new PNGMetadataError('PNG_MISSING');
  } catch (error) {
    if (error instanceof PNGMetadataError) throw error;
    throw new PNGMetadataError('PNG_INPUT');
  }
}

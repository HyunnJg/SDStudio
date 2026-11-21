// Main-only diagnostic labels. No filenames, payloads, prompts or server messages.
export const IMAGE_RESPONSE_REASONS = Object.freeze([
  'zip-eocd',
  'zip-volume',
  'zip-entry-count',
  'zip-central',
  'zip-flags',
  'zip-method',
  'zip-prefix',
  'zip-symlink',
  'zip-size',
  'zip-extra',
  'zip64',
  'zip-name',
  'zip-local',
  'zip-descriptor',
  'zip-inflate',
  'zip-expanded-size',
  'zip-deflate-trailing',
  'zip-crc',
  'png-signature',
  'png-chunk',
  'png-crc',
  'png-ihdr',
  'png-pixel-limit',
  'png-format',
  'png-idat',
  'png-iend',
  'png-trailing',
  'response-input',
  'response-compressed-limit',
  'response-expanded-limit',
  'response-cancelled',
  'response-deadline',
  'response-internal',
] as const);
export type ImageResponseReason = (typeof IMAGE_RESPONSE_REASONS)[number];
export function isImageResponseReason(
  value: unknown,
): value is ImageResponseReason {
  return (
    typeof value === 'string' &&
    (IMAGE_RESPONSE_REASONS as readonly string[]).includes(value)
  );
}

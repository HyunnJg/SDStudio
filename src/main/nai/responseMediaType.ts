// Main-only diagnostic metadata. Parameters/raw headers are never retained here.
export interface ResponseMediaType {
  mediaTypeState: 'present' | 'absent' | 'invalid';
  mediaType?: string;
}

export function describeResponseMediaType(value: unknown): ResponseMediaType {
  if (value === undefined || value === null)
    return { mediaTypeState: 'absent' };
  const raw = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (typeof raw !== 'string' || raw.length > 512 || /[\r\n\0]/.test(raw))
    return { mediaTypeState: 'invalid' };
  const mediaType = raw.split(';', 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/.test(mediaType))
    return { mediaTypeState: 'invalid' };
  return { mediaTypeState: 'present', mediaType };
}

export function mediaTypeBucket(value: ResponseMediaType): string {
  if (value.mediaTypeState !== 'present') return value.mediaTypeState;
  return [
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'application/json',
    'text/plain',
    'text/html',
  ].includes(value.mediaType ?? '')
    ? value.mediaType!
    : 'other';
}

import type { NaiErrorCode } from '../../naiAuth';
import { isImageResponseReason } from './responseReasons';
import type { ImageResponseReason } from './responseReasons';

// Never retain raw OS/network/server errors: they can contain secrets or prompts.
export class NaiError extends Error {
  declare readonly imageResponseReason?: ImageResponseReason;

  constructor(
    readonly code: NaiErrorCode,
    readonly mayHaveReachedServer = false,
    readonly httpStatus?: number,
    reason?: ImageResponseReason,
  ) {
    super(code);
    this.name = 'NaiError';
    if (isImageResponseReason(reason))
      Object.defineProperty(this, 'imageResponseReason', {
        value: reason,
        enumerable: false,
      });
  }
}

export function validateToken(value: unknown): string {
  // Opaque token; this is a local header/size guard, not a token-format claim.
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value)) {
    throw new NaiError('INVALID_INPUT');
  }
  return value;
}

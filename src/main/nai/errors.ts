import type { NaiErrorCode } from '../../naiAuth';

// Never retain raw OS/network/server errors: they can contain secrets or prompts.
export class NaiError extends Error {
  constructor(
    readonly code: NaiErrorCode,
    readonly mayHaveReachedServer = false,
    readonly httpStatus?: number,
  ) {
    super(code);
    this.name = 'NaiError';
  }
}

export function validateToken(value: unknown): string {
  // Opaque token; this is a local header/size guard, not a token-format claim.
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value)) {
    throw new NaiError('INVALID_INPUT');
  }
  return value;
}

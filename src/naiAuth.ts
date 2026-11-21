// Shared IPC shapes contain no token-returning operation.
export type NaiErrorCode =
  | 'OFFLINE'
  | 'UNTRUSTED_SENDER'
  | 'INVALID_INPUT'
  | 'TOKEN_MISSING'
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'STORE_UNREADABLE'
  | 'STORE_VERSION'
  | 'STORE_WRITE_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'REDIRECT'
  | 'HTTP_ERROR'
  | 'RESPONSE_TOO_LARGE';

export interface NaiTokenStatus {
  configured: boolean;
  storage: 'none' | 'session' | 'encrypted';
  secureStorageAvailable: boolean;
}

export type NaiAuthResult =
  { ok: true; status: NaiTokenStatus } | { ok: false; code: NaiErrorCode };

// Shared IPC shapes contain no token-returning operation.
export type NaiErrorCode =
  | 'OFFLINE'
  | 'UNTRUSTED_SENDER'
  | 'INVALID_INPUT'
  | 'WRONG_PROVIDER'
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
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_IMAGE_RESPONSE'
  | 'RESPONSE_FORMAT'
  | 'RESPONSE_CAPTURE_FAILED';

export interface NaiTokenStatus {
  configured: boolean;
  storage: 'none' | 'session' | 'encrypted';
  secureStorageAvailable: boolean;
  locallyReadable?: true;
}

export type NaiAuthResult =
  { ok: true; status: NaiTokenStatus } | { ok: false; code: NaiErrorCode };

export interface NaiAuthClient {
  status: () => Promise<NaiAuthResult>;
  setToken: (token: string, remember: boolean) => Promise<NaiAuthResult>;
  check: () => Promise<NaiAuthResult>;
  clear: () => Promise<NaiAuthResult>;
}

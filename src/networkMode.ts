export type NetworkMode = 'offline' | 'online';
export type NetworkModeErrorCode =
  | 'INVALID_MODE'
  | 'MODE_LOCKED'
  | 'UNTRUSTED_SENDER'
  | 'SETTINGS_UNREADABLE'
  | 'SETTINGS_VERSION'
  | 'SETTINGS_WRITE_FAILED'
  | 'NO_RESTART_REQUIRED'
  | 'RESTART_FAILED'
  | 'RESTARTING';

export interface NetworkModeStatus {
  current: NetworkMode;
  next: NetworkMode;
  pendingRestart: boolean;
  lockedReason?: 'mock' | 'environment' | 'development';
  issue?: 'SETTINGS_UNREADABLE' | 'SETTINGS_VERSION';
}
export type NetworkModeResult =
  | { ok: true; status: NetworkModeStatus }
  | { ok: false; code: NetworkModeErrorCode };

export interface NetworkModeClient {
  status: () => Promise<NetworkModeResult>;
  set: (mode: NetworkMode) => Promise<NetworkModeResult>;
  reset: () => Promise<NetworkModeResult>;
  restart: () => Promise<NetworkModeResult>;
}

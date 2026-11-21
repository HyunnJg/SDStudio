/* eslint max-classes-per-file: off */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type {
  NetworkMode,
  NetworkModeErrorCode,
  NetworkModeStatus,
  NetworkModeResult,
} from '../networkMode';

export class NetworkModeError extends Error {
  constructor(readonly code: NetworkModeErrorCode) {
    super(code);
  }
}

export class NetworkModeSettings {
  readonly current: NetworkMode;

  readonly lockedReason?: NetworkModeStatus['lockedReason'];

  private readonly file: string;

  restarting = false;

  constructor(
    file: string,
    explicit: boolean,
    env: Record<string, string | undefined>,
  ) {
    this.file = file;
    if (env.SDSTUDIO_MOCK_BACKEND === '1') this.lockedReason = 'mock';
    else if (env.SDSTUDIO_OFFLINE !== undefined)
      this.lockedReason = 'environment';
    else if (explicit) this.lockedReason = 'development';
    if (this.lockedReason) {
      this.current =
        this.lockedReason === 'environment' && env.SDSTUDIO_OFFLINE === '0'
          ? 'online'
          : 'offline';
    } else this.current = this.saved().mode;
  }

  private saved(): { mode: NetworkMode; issue?: NetworkModeStatus['issue'] } {
    try {
      if (fs.statSync(this.file).size > 2048)
        return { mode: 'offline', issue: 'SETTINGS_UNREADABLE' };
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return { mode: 'offline', issue: 'SETTINGS_UNREADABLE' };
      if (value.version !== 1)
        return { mode: 'offline', issue: 'SETTINGS_VERSION' };
      if (
        !['offline', 'online'].includes(value.mode) ||
        Object.keys(value).some((key) => !['version', 'mode'].includes(key))
      ) {
        return { mode: 'offline', issue: 'SETTINGS_UNREADABLE' };
      }
      return { mode: value.mode };
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT')
        return { mode: 'offline' };
      return { mode: 'offline', issue: 'SETTINGS_UNREADABLE' };
    }
  }

  status(): NetworkModeStatus {
    const saved = this.saved();
    const next = this.lockedReason ? this.current : saved.mode;
    return {
      current: this.current,
      next,
      pendingRestart: this.current !== next,
      ...(this.lockedReason ? { lockedReason: this.lockedReason } : {}),
      ...(saved.issue ? { issue: saved.issue } : {}),
    };
  }

  private editable(): void {
    if (this.lockedReason) throw new NetworkModeError('MODE_LOCKED');
    if (this.restarting) throw new NetworkModeError('RESTARTING');
  }

  set(mode: unknown): NetworkModeStatus {
    this.editable();
    if (mode !== 'offline' && mode !== 'online')
      throw new NetworkModeError('INVALID_MODE');
    const existing = this.saved();
    if (existing.issue) throw new NetworkModeError(existing.issue);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, mode })}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, this.file);
    } catch {
      throw new NetworkModeError('SETTINGS_WRITE_FAILED');
    } finally {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        /* Best-effort cleanup of a non-secret settings file. */
      }
    }
    return this.status(); // The running mode remains immutable until next process start.
  }

  reset(): NetworkModeStatus {
    this.editable();
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      throw new NetworkModeError('SETTINGS_WRITE_FAILED');
    }
    return this.status();
  }

  restart(relaunch: () => void): NetworkModeStatus {
    this.editable();
    const status = this.status();
    if (status.issue) throw new NetworkModeError(status.issue);
    if (!status.pendingRestart)
      throw new NetworkModeError('NO_RESTART_REQUIRED');
    this.restarting = true;
    try {
      relaunch();
    } catch {
      this.restarting = false;
      throw new NetworkModeError('RESTART_FAILED');
    }
    return status;
  }
}

export function registerNetworkMode(
  ipc: Pick<IpcMain, 'handle'>,
  settings: NetworkModeSettings,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  relaunch: () => void,
): void {
  const handle = (
    channel: string,
    action: (...args: unknown[]) => NetworkModeStatus,
  ) => {
    ipc.handle(channel, (event, ...args): NetworkModeResult => {
      try {
        if (!trusted(event)) throw new NetworkModeError('UNTRUSTED_SENDER');
        return { ok: true, status: action(...args) };
      } catch (error) {
        return {
          ok: false,
          code:
            error instanceof NetworkModeError
              ? error.code
              : 'SETTINGS_UNREADABLE',
        };
      }
    });
  };
  // Local startup preferences must be usable while offline; this is not an API gate.
  handle('network-mode-status', () => settings.status());
  handle('network-mode-set', (mode) => settings.set(mode));
  handle('network-mode-reset', () => settings.reset());
  handle('network-mode-restart', () => settings.restart(relaunch));
}

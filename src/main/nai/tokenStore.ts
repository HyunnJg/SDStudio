/* eslint import/prefer-default-export: off */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SafeStorage } from 'electron';
import type { NaiTokenStatus } from '../../naiAuth';
import { NaiError, validateToken } from './errors';

type Encryption = Pick<
  SafeStorage,
  | 'isEncryptionAvailable'
  | 'getSelectedStorageBackend'
  | 'encryptString'
  | 'decryptString'
>;

export class NaiTokenStore {
  private memory?: string;

  private readonly file: string;

  private readonly encryption: Encryption;

  private readonly platform: typeof process.platform;

  constructor(
    file: string,
    encryption: Encryption,
    platform = process.platform,
  ) {
    this.file = file;
    this.encryption = encryption;
    this.platform = platform;
  }

  private available(): boolean {
    try {
      if (!this.encryption.isEncryptionAvailable()) return false;
      return (
        this.platform !== 'linux' ||
        ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
          this.encryption.getSelectedStorageBackend(),
        )
      );
    } catch {
      return false;
    }
  }

  status(): NaiTokenStatus {
    // No decryption or TOKEN.txt migration on startup/status.
    let storage: NaiTokenStatus['storage'] = 'none';
    if (this.memory !== undefined) storage = 'session';
    else if (fs.existsSync(this.file)) storage = 'encrypted';
    return {
      configured: storage !== 'none',
      storage,
      secureStorageAvailable: this.available(),
    };
  }

  private envelope(): { version: 1; ciphertext: string } {
    try {
      if (fs.statSync(this.file).size > 16384)
        throw new NaiError('STORE_UNREADABLE');
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value.version !== 1) throw new NaiError('STORE_VERSION');
      if (
        value.format !== 'sdstudio-nai-token' ||
        typeof value.ciphertext !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          value.ciphertext,
        ) ||
        value.ciphertext.length === 0
      )
        throw new NaiError('STORE_UNREADABLE');
      return value;
    } catch (error) {
      if (error instanceof NaiError) throw error;
      throw new NaiError('STORE_UNREADABLE');
    }
  }

  read(): string {
    if (this.memory !== undefined) return this.memory;
    if (!fs.existsSync(this.file)) throw new NaiError('TOKEN_MISSING');
    const saved = this.envelope();
    if (!this.available()) throw new NaiError('SECURE_STORAGE_UNAVAILABLE');
    try {
      return validateToken(
        this.encryption.decryptString(Buffer.from(saved.ciphertext, 'base64')),
      );
    } catch {
      // Keep the ciphertext unchanged; clear/re-enter is an explicit user action.
      throw new NaiError('STORE_UNREADABLE');
    }
  }

  set(value: unknown, remember: unknown): NaiTokenStatus {
    const token = validateToken(value);
    if (typeof remember !== 'boolean') throw new NaiError('INVALID_INPUT');
    if (!remember) {
      this.removeFile(); // Do not resurrect an old persistent token next launch.
      this.memory = token;
      return this.status();
    }
    if (!this.available()) throw new NaiError('SECURE_STORAGE_UNAVAILABLE');
    if (fs.existsSync(this.file)) this.envelope(); // Preserve unsupported/corrupt records.
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const ciphertext = this.encryption
        .encryptString(token)
        .toString('base64');
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        temporary,
        JSON.stringify({
          format: 'sdstudio-nai-token',
          version: 1,
          ciphertext,
        }),
        { mode: 0o600, flag: 'wx' },
      );
      fs.renameSync(temporary, this.file);
      this.memory = undefined;
    } catch {
      throw new NaiError('STORE_WRITE_FAILED');
    } finally {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Best effort: a failed cleanup can leave only an encrypted temporary file.
      }
    }
    return this.status();
  }

  private removeFile(): void {
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      throw new NaiError('STORE_WRITE_FAILED');
    }
  }

  clear(): NaiTokenStatus {
    this.removeFile();
    this.lock();
    return this.status();
  }

  lock(): void {
    // JS strings cannot be guaranteed to be zeroed; drop our live reference.
    this.memory = undefined;
  }
}

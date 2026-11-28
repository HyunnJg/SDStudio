/* eslint import/prefer-default-export: off, no-useless-constructor: off, no-empty-function: off */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SafeStorage } from 'electron';
import type { NaiTokenStatus } from '../../naiAuth';
import { NaiError, validateToken } from './errors';

type Encryption = Pick<
  SafeStorage,
  | 'isAsyncEncryptionAvailable'
  | 'getSelectedStorageBackend'
  | 'encryptStringAsync'
  | 'decryptStringAsync'
>;

export class NaiTokenStore {
  private memory?: string;

  private generation = 0;

  private pending?: Promise<NaiTokenStatus>;

  private lastAvailable = false;

  constructor(
    private readonly file: string,
    private readonly encryption: Encryption,
    private readonly platform = process.platform,
    private readonly format = 'sdstudio-nai-token',
    private readonly validate = validateToken,
  ) {}

  private guard(generation: number): void {
    if (generation !== this.generation) throw new NaiError('CANCELLED');
  }

  private supportedBackend(): boolean {
    return (
      this.platform !== 'linux' ||
      ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
        this.encryption.getSelectedStorageBackend(),
      )
    );
  }

  private async available(): Promise<boolean> {
    const { generation } = this;
    let available = false;
    try {
      // Do not initialize a known insecure fallback even if its async API returns true.
      available =
        this.supportedBackend() &&
        (await this.encryption.isAsyncEncryptionAvailable()) &&
        this.supportedBackend();
    } catch {
      /* No raw provider exceptions cross this boundary. */
    }
    if (generation === this.generation) this.lastAvailable = available;
    return available;
  }

  private describe(
    secureStorageAvailable = this.lastAvailable,
  ): NaiTokenStatus {
    let storage: NaiTokenStatus['storage'] = 'none';
    if (this.memory !== undefined) storage = 'session';
    else if (fs.existsSync(this.file)) storage = 'encrypted';
    return { configured: storage !== 'none', storage, secureStorageAvailable };
  }

  async status(): Promise<NaiTokenStatus> {
    const { generation } = this;
    const available = await this.available();
    // Status never decrypts. Describe current state if a concurrent mutation finished.
    return this.describe(
      generation === this.generation ? available : this.lastAvailable,
    );
  }

  private envelope(): { ciphertext: string; bytes: Buffer } {
    try {
      if (fs.statSync(this.file).size > 16384)
        throw new NaiError('STORE_UNREADABLE');
      const bytes = fs.readFileSync(this.file);
      if (bytes.length > 16384) throw new NaiError('STORE_UNREADABLE');
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.version !== 1) throw new NaiError('STORE_VERSION');
      if (
        value.format !== this.format ||
        typeof value.ciphertext !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          value.ciphertext,
        ) ||
        !value.ciphertext.length
      )
        throw new NaiError('STORE_UNREADABLE');
      return { ciphertext: value.ciphertext, bytes };
    } catch (error) {
      if (error instanceof NaiError) throw error;
      throw new NaiError('STORE_UNREADABLE');
    }
  }

  async read(): Promise<string> {
    const { generation } = this;
    const { pending } = this;
    if (pending) {
      try {
        await pending;
      } catch {
        // The setter reports its own failure. Read the preserved state below;
        // a newer set/clear/lock still fails the generation guard.
      }
    }
    this.guard(generation);
    if (this.memory !== undefined) return this.memory;
    if (!fs.existsSync(this.file)) throw new NaiError('TOKEN_MISSING');
    const saved = this.envelope();
    const available = await this.available();
    this.guard(generation);
    if (!available) throw new NaiError('SECURE_STORAGE_UNAVAILABLE');
    let result;
    try {
      result = await this.encryption.decryptStringAsync(
        Buffer.from(saved.ciphertext, 'base64'),
      );
    } catch (error) {
      this.guard(generation);
      if (
        (error as { isTemporarilyUnavailable?: boolean })
          ?.isTemporarilyUnavailable === true
      )
        throw new NaiError('SECURE_STORAGE_UNAVAILABLE');
      throw new NaiError('STORE_UNREADABLE');
    }
    this.guard(generation);
    try {
      if (typeof result.shouldReEncrypt !== 'boolean')
        throw new Error('Invalid provider result');
      // A rotation hint does not authorize rewriting an existing ciphertext on read.
      return this.validate(result.result);
    } catch {
      throw new NaiError('STORE_UNREADABLE');
    }
  }

  async set(value: unknown, remember: unknown): Promise<NaiTokenStatus> {
    const token = this.validate(value);
    if (typeof remember !== 'boolean') throw new NaiError('INVALID_INPUT');
    this.generation += 1;
    const { generation } = this;
    const operation = this.applySet(token, remember, generation).then(() =>
      this.describe(),
    );
    this.pending = operation;
    const finished = () => {
      if (this.pending === operation) this.pending = undefined;
    };
    // Attach both handlers without retaining a rejected bookkeeping promise.
    // Both branches are handled; bookkeeping cannot reject.
    // eslint-disable-next-line promise/catch-or-return
    operation.then(finished, finished);
    return operation;
  }

  private async applySet(
    token: string,
    remember: boolean,
    generation: number,
  ): Promise<void> {
    this.guard(generation);
    const previous = fs.existsSync(this.file)
      ? this.envelope().bytes
      : undefined;
    if (!remember) {
      this.removeFile();
      this.memory = token;
      return;
    }
    const available = await this.available();
    this.guard(generation);
    if (!available) throw new NaiError('SECURE_STORAGE_UNAVAILABLE');
    let encrypted: Buffer;
    try {
      encrypted = await this.encryption.encryptStringAsync(token);
    } catch {
      this.guard(generation);
      throw new NaiError('STORE_WRITE_FAILED');
    }
    this.guard(generation);
    // An external replacement during the OS await is not ours to overwrite.
    const current = fs.existsSync(this.file)
      ? this.envelope().bytes
      : undefined;
    if (previous ? !current?.equals(previous) : current !== undefined)
      throw new NaiError('CANCELLED');
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      if (
        !Buffer.isBuffer(encrypted) ||
        encrypted.length === 0 ||
        encrypted.length > 12000
      )
        throw new Error('Invalid encrypted result');
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        temporary,
        JSON.stringify({
          format: this.format,
          version: 1,
          ciphertext: encrypted.toString('base64'),
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
        /* Encrypted temp only. */
      }
    }
  }

  private removeFile(): void {
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      throw new NaiError('STORE_WRITE_FAILED');
    }
  }

  async clear(): Promise<NaiTokenStatus> {
    this.generation += 1;
    this.pending = undefined;
    this.removeFile();
    this.memory = undefined;
    return this.describe();
  }

  lock(): void {
    this.generation += 1;
    this.pending = undefined;
    // JS strings cannot be guaranteed to be zeroed; drop the live reference.
    this.memory = undefined;
  }
}

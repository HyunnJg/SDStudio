/* eslint no-bitwise: off -- POSIX permission masks. */
/* eslint max-classes-per-file: off */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { NaiTransport } from './transport';
import { NaiError } from './errors';
import { readNaiImageResponse, IMAGE_RESPONSE_LIMITS } from './imageResponse';

export class ValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
interface CostEvidence {
  requestHash: string;
  beforeBalance: number;
  displayedCost: number;
  sameSettings: true;
  capture: true;
  candidateAcknowledged: true;
}
interface Options {
  profile: string;
  request: Record<string, any>;
  ready: () => void;
  transport: (
    capture: (bytes: Uint8Array) => void,
  ) => Pick<NaiTransport, 'send'>;
  metadata?: () => {
    httpStatus?: number;
    contentType?: string;
    truncated?: boolean;
  };
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function writePrivate(file: string, value: unknown): void {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export class LiveValidation {
  readonly requestHash: string;

  readonly directory: string;

  private readonly body: Uint8Array;

  private readonly options: Options;

  private used = false;

  private finished = false;

  constructor(options: Options) {
    this.options = options;
    this.body = Uint8Array.from(Buffer.from(JSON.stringify(options.request)));
    const p = options.request.parameters;
    if (
      this.body.length > 4 * 1024 * 1024 ||
      options.request.action !== 'generate' ||
      !/^[a-z0-9-]{1,80}$/.test(options.request.model) ||
      typeof options.request.input !== 'string' ||
      !options.request.input.trim() ||
      !p ||
      p.n_samples !== 1 ||
      !integer(p.width) ||
      !integer(p.height) ||
      p.width < 1 ||
      p.height < 1 ||
      p.width * p.height > 1024 * 1024 ||
      !integer(p.steps) ||
      p.steps < 1 ||
      p.steps > 28
    )
      throw new ValidationError('INVALID_CANDIDATE');
    this.requestHash = createHash('sha256').update(this.body).digest('hex');
    // Caller selects an isolated, canonical profile before Electron is ready.
    try {
      const root = fs.realpathSync(options.profile);
      this.directory = path.join(root, 'live-validation');
      if (!fs.existsSync(this.directory))
        fs.mkdirSync(this.directory, { mode: 0o700 });
      const stat = fs.lstatSync(this.directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.platform !== 'win32' &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()))
      )
        throw new Error('private directory required');
      this.used = fs.existsSync(path.join(this.directory, 'attempt.json'));
      this.finished =
        this.used && fs.existsSync(path.join(this.directory, 'result.json'));
      if (
        !this.used &&
        [
          'response.zip',
          'result.json',
          'result.png',
          'balance-after.json',
        ].some((name) => fs.existsSync(path.join(this.directory, name)))
      )
        throw new Error('orphan validation output');
    } catch {
      throw new ValidationError('STORAGE_FAILED');
    }
  }

  status() {
    return {
      used: this.used,
      finished: this.finished,
      requestHash: this.requestHash,
    };
  }

  async run(evidence: CostEvidence, signal?: AbortSignal) {
    if (this.used) throw new ValidationError('ALREADY_USED');
    if (evidence?.requestHash !== this.requestHash)
      throw new ValidationError('REQUEST_CHANGED');
    if (evidence.capture !== true)
      throw new ValidationError('CAPTURE_REQUIRED');
    if (
      evidence.sameSettings !== true ||
      evidence.candidateAcknowledged !== true ||
      !integer(evidence.beforeBalance) ||
      !integer(evidence.displayedCost)
    )
      throw new ValidationError('COST_EVIDENCE_REQUIRED');
    if (evidence.displayedCost > 10) throw new ValidationError('COST_LIMIT');
    if (evidence.beforeBalance < evidence.displayedCost)
      throw new ValidationError('BALANCE_LOW');
    if (signal?.aborted) throw new NaiError('CANCELLED');
    this.options.ready(); // Local readability/offline checks only; no account API call.
    let fd: number;
    try {
      writePrivate(path.join(this.directory, 'attempt.json'), {
        version: 1,
        requestHash: this.requestHash,
        startedAt: new Date().toISOString(),
        costSource: 'user-verified-novelai-web-same-settings',
        beforeBalance: evidence.beforeBalance,
        displayedCost: evidence.displayedCost,
        maxRequests: 1,
        maxDisplayedAnlas: 10,
        rawResponseCapture: true,
      });
      this.used = true; // Durable wx claim also prevents another process using this profile.
      fd = fs.openSync(path.join(this.directory, 'response.zip'), 'wx', 0o600);
    } catch {
      this.used = fs.existsSync(path.join(this.directory, 'attempt.json'));
      throw new ValidationError('STORAGE_FAILED');
    }
    const deadline = performance.now() + 90000;
    let reached = false;
    let captured = false;
    let responseBytes = 0;
    let zipHeader:
      { flags: number; method: number; extraBytes: number } | undefined;
    let result: Record<string, unknown>;
    try {
      const capture = (response: Uint8Array) => {
        reached = true;
        if (captured || response.byteLength > IMAGE_RESPONSE_LIMITS.zipBytes)
          throw new NaiError('RESPONSE_CAPTURE_FAILED', true);
        fs.writeFileSync(fd, response);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = -1;
        captured = true;
        responseBytes = response.byteLength;
        if (response.byteLength >= 30) {
          const header = new DataView(
            response.buffer,
            response.byteOffset,
            response.byteLength,
          );
          if (header.getUint32(0, true) === 0x04034b50)
            zipHeader = {
              flags: header.getUint16(6, true),
              method: header.getUint16(8, true),
              extraBytes: header.getUint16(28, true),
            };
        }
      };
      const response = await this.options
        .transport(capture)
        .send(this.body, signal, 90000);
      reached = true;
      if (!captured) capture(response);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new NaiError('TIMEOUT', true);
      const png = await readNaiImageResponse(response, signal, remaining);
      fs.writeFileSync(path.join(this.directory, 'result.png'), png, {
        flag: 'wx',
        mode: 0o600,
      });
      result = {
        ok: true,
        pngBytes: png.byteLength,
        pngSaved: true,
        mayHaveReachedServer: true,
      };
    } catch (error) {
      result =
        error instanceof NaiError
          ? {
              ok: false,
              code: error.code,
              reason: error.imageResponseReason,
              mayHaveReachedServer: reached || error.mayHaveReachedServer,
            }
          : {
              ok: false,
              code: 'STORAGE_FAILED',
              mayHaveReachedServer: reached,
            };
    } finally {
      if (fd >= 0) {
        try {
          fs.closeSync(fd);
        } catch {
          /* No retry or raw OS details. */
        }
      }
    }
    let metadata: {
      httpStatus?: number;
      contentType?: string;
      truncated?: boolean;
    } = {};
    try {
      metadata = this.options.metadata?.() ?? {};
    } catch {
      /* Diagnostic observer cannot retry a request. */
    }
    result = {
      ...result,
      requestHash: this.requestHash,
      responseCaptured: captured,
      responseBytes,
      ...(zipHeader ? { zipHeader } : {}),
      ...(integer(metadata.httpStatus) &&
      metadata.httpStatus! >= 100 &&
      metadata.httpStatus! <= 599
        ? { httpStatus: metadata.httpStatus }
        : {}),
      ...([
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
        'application/json',
        'text/plain',
        'text/html',
        'other',
      ].includes(metadata.contentType ?? '')
        ? { contentType: metadata.contentType }
        : {}),
      captureTruncated: metadata.truncated === true,
      finishedAt: new Date().toISOString(),
    };
    try {
      writePrivate(path.join(this.directory, 'result.json'), result);
      this.finished = true;
    } catch {
      return { ...result, recordError: 'STORAGE_FAILED' };
    }
    return result;
  }

  recordAfterBalance(value: unknown) {
    if (!this.used || !this.finished) throw new ValidationError('NOT_FINISHED');
    if (!integer(value)) throw new ValidationError('COST_EVIDENCE_REQUIRED');
    try {
      const file = path.join(this.directory, 'attempt.json');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
        throw new Error('invalid record');
      const before = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!integer(before.beforeBalance))
        throw new ValidationError('STORAGE_FAILED');
      if (before.requestHash !== this.requestHash)
        throw new ValidationError('REQUEST_CHANGED');
      writePrivate(path.join(this.directory, 'balance-after.json'), {
        requestHash: this.requestHash,
        afterBalance: value,
        observedDifference: before.beforeBalance - value,
        source: 'user-verified-novelai-web',
        recordedAt: new Date().toISOString(),
        note: 'Observed balance difference is not proof of a per-request charge.',
      });
      return { ok: true };
    } catch (error) {
      throw error instanceof ValidationError
        ? error
        : new ValidationError('STORAGE_FAILED');
    }
  }
}

import type {
  ClientRequest,
  ClientRequestConstructorOptions,
  Session,
} from 'electron';
import { NaiError, validateToken } from './errors';
import { readNaiImageResponse } from './imageResponse';

export const IMAGE_ENDPOINT = 'https://image.novelai.net/ai/generate-image';

interface TransportOptions {
  request: (options: ClientRequestConstructorOptions) => ClientRequest;
  session: Session;
  offline: () => boolean;
  token: () => string | Promise<string>;
  // Explicit research-tool opt-in only. Never returned through auth IPC or errors.
  diagnosticCapture?: (result: {
    bytes: Uint8Array;
    truncated: boolean;
  }) => void;
}

// Production generation IPC/model binding is pending. Research callers stay in main.
export class NaiTransport {
  private readonly options: TransportOptions;

  constructor(options: TransportOptions) {
    this.options = options;
  }

  async sendImage(
    body: Uint8Array,
    signal?: AbortSignal,
    timeoutMs = 90000,
  ): Promise<Uint8Array> {
    const deadline = performance.now() + timeoutMs;
    const response = await this.send(body, signal, timeoutMs);
    try {
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new NaiError('TIMEOUT', false, undefined, 'response-deadline');
      return await readNaiImageResponse(response, signal, remaining);
    } catch (error) {
      throw new NaiError(
        error instanceof NaiError ? error.code : 'INVALID_IMAGE_RESPONSE',
        true, // A response arrived; decoding failure must never imply no server processing.
        undefined,
        error instanceof NaiError ? error.imageResponseReason : undefined,
      );
    }
  }

  send(
    body: Uint8Array,
    signal?: AbortSignal,
    timeoutMs = 90000,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let request: ClientRequest | undefined;
      let sent = false;
      let deadline = Infinity;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: () => void;
      const finish = (error?: NaiError, result?: Uint8Array) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (error) {
          try {
            request?.abort();
          } catch {
            /* Already closed; retain the original failure code. */
          }
          reject(error);
        } else resolve(result!);
      };
      cancel = () => finish(new NaiError('CANCELLED', sent));
      const guard = () => {
        if (performance.now() >= deadline) throw new NaiError('TIMEOUT', sent);
        if (this.options.offline()) throw new NaiError('OFFLINE', sent);
        if (signal?.aborted) throw new NaiError('CANCELLED', sent);
      };
      // Snapshot the caller's bytes before the first asynchronous boundary.
      let payload: Buffer;
      try {
        guard();
        if (
          !(body instanceof Uint8Array) ||
          body.byteLength === 0 ||
          body.byteLength > 4 * 1024 * 1024 ||
          !Number.isInteger(timeoutMs) ||
          timeoutMs < 1 ||
          timeoutMs > 180000
        ) {
          throw new NaiError('INVALID_INPUT');
        }
        payload = Buffer.from(body);
        signal?.addEventListener('abort', cancel, { once: true });
        deadline = performance.now() + timeoutMs;
        timer = setTimeout(
          () => finish(new NaiError('TIMEOUT', sent)),
          timeoutMs,
        );
      } catch (error) {
        finish(
          error instanceof NaiError ? error : new NaiError('INVALID_INPUT'),
        );
        return;
      }
      (async () => {
        try {
          const token = validateToken(await this.options.token());
          if (settled) return;
          guard(); // Stop/offline may change while credentials or cooldown are awaited.
          request = this.options.request({
            url: IMAGE_ENDPOINT,
            method: 'POST',
            session: this.options.session,
            redirect: 'manual',
            credentials: 'omit',
            useSessionCookies: false,
          });
          request.on('error', () => finish(new NaiError('NETWORK', sent)));
          request.on('abort', () => finish(new NaiError('CANCELLED', sent)));
          request.on('redirect', () => finish(new NaiError('REDIRECT', sent)));
          // Electron 26 can emit writable close after finish, before HTTP response.
          // Response end/error/aborted and the deadline determine transaction completion.
          request.on('response', (response) => {
            if (settled) return;
            response.on('error', () => finish(new NaiError('NETWORK', sent)));
            response.on('aborted', () => finish(new NaiError('NETWORK', sent)));
            const statusError =
              response.statusCode < 200 || response.statusCode >= 300
                ? new NaiError('HTTP_ERROR', sent, response.statusCode)
                : undefined;
            const responseError =
              statusError ??
              (!/^application\/(zip|x-zip-compressed|octet-stream)(;|$)/i.test(
                String(response.headers['content-type'] || '').trim(),
              )
                ? new NaiError('RESPONSE_FORMAT', sent, response.statusCode)
                : undefined);
            if (responseError && !this.options.diagnosticCapture) {
              finish(responseError);
              return;
            }
            const limit = responseError ? 64 * 1024 : 64 * 1024 * 1024;
            const chunks: Uint8Array[] = [];
            let size = 0;
            const complete = (truncated = false) => {
              if (settled) return;
              const joined = new Uint8Array(size);
              let offset = 0;
              chunks.forEach((chunk) => {
                joined.set(chunk, offset);
                offset += chunk.length;
              });
              try {
                this.options.diagnosticCapture?.({
                  bytes: Uint8Array.from(joined),
                  truncated,
                });
              } catch {
                finish(new NaiError('RESPONSE_CAPTURE_FAILED', sent));
                return;
              }
              try {
                guard();
              } catch (error) {
                finish(
                  error instanceof NaiError
                    ? error
                    : new NaiError('NETWORK', sent),
                );
                return;
              }
              finish(responseError, responseError ? undefined : joined);
            };
            response.on('data', (chunk: Buffer) => {
              if (settled) return;
              if (size + chunk.length > limit) {
                if (!responseError) {
                  finish(new NaiError('RESPONSE_TOO_LARGE', sent));
                  return;
                }
                chunks.push(Uint8Array.from(chunk.subarray(0, limit - size)));
                size = limit;
                complete(true);
              } else {
                size += chunk.length;
                chunks.push(Uint8Array.from(chunk));
              }
            });
            response.on('end', () => complete());
          });
          request.setHeader('Authorization', `Bearer ${token}`);
          request.setHeader('Content-Type', 'application/json');
          request.setHeader('Accept', 'application/zip');
          guard();
          sent = true; // A write can begin transmission; cancellation cannot prove no charge.
          request.write(payload);
          request.end();
        } catch (error) {
          finish(
            error instanceof NaiError ? error : new NaiError('NETWORK', sent),
          );
        }
      })().catch(() => finish(new NaiError('NETWORK', sent)));
    });
  }
}

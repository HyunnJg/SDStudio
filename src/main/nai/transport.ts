import type {
  ClientRequest,
  ClientRequestConstructorOptions,
  Session,
} from 'electron';
import { NaiError, validateToken } from './errors';

export const IMAGE_ENDPOINT = 'https://image.novelai.net/ai/generate-image';

interface TransportOptions {
  request: (options: ClientRequestConstructorOptions) => ClientRequest;
  session: Session;
  offline: () => boolean;
  token: () => string | Promise<string>;
}

// No model binding or generation IPC exists yet. Only main-process callers may use this.
export class NaiTransport {
  private readonly options: TransportOptions;

  constructor(options: TransportOptions) {
    this.options = options;
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
            if (response.statusCode < 200 || response.statusCode >= 300) {
              finish(new NaiError('HTTP_ERROR', sent, response.statusCode));
              return;
            }
            if (
              !/^application\/(zip|x-zip-compressed|octet-stream)(;|$)/i.test(
                String(response.headers['content-type'] || '').trim(),
              )
            ) {
              finish(new NaiError('HTTP_ERROR', sent, response.statusCode));
              return;
            }
            const chunks: Uint8Array[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              if (settled) return;
              size += chunk.length;
              if (size > 64 * 1024 * 1024)
                finish(new NaiError('RESPONSE_TOO_LARGE', sent));
              else chunks.push(Uint8Array.from(chunk));
            });
            response.on('end', () => {
              if (settled) return;
              const joined = new Uint8Array(size);
              let offset = 0;
              chunks.forEach((chunk) => {
                joined.set(chunk, offset);
                offset += chunk.length;
              });
              finish(undefined, joined);
            });
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

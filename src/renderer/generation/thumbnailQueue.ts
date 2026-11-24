/* eslint no-void: off, no-use-before-define: off -- Abort and completion handlers share the same queued job. */
/** Serialize visible thumbnail reads. Aborted queued jobs never reach IPC. */
export default class ThumbnailQueue {
  private active = false;

  private waiting: (() => void)[] = [];

  read<T>(load: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancelled = () => new DOMException('Cancelled', 'AbortError');
      const start = async () => {
        this.active = true;
        try {
          const value = await load();
          if (signal.aborted) reject(cancelled());
          else resolve(value);
        } catch (error) {
          reject(error);
        } finally {
          signal.removeEventListener('abort', abort);
          this.active = false;
          this.waiting.shift()?.();
        }
      };
      const job = () => {
        void start();
      };
      const abort = () => {
        this.waiting = this.waiting.filter((queued) => queued !== job);
        reject(cancelled());
      };
      if (signal.aborted) {
        reject(cancelled());
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      if (this.active) this.waiting.push(job);
      else job();
    });
  }
}

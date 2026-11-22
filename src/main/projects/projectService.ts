/* eslint import/prefer-default-export: off */
import { Worker } from 'worker_threads';
import path from 'path';
import { ProjectError } from '../../workspaceProject';
import type { ProjectOperations } from './projectIpc';
import type { ProjectStore } from './projectStore';

// A single bounded queue in a dedicated Node worker keeps sync disk/hash work off Electron main.
export class ProjectService implements ProjectOperations {
  private worker?: Worker;

  private closed = false;

  private stopped = false;

  private restarting = false;

  private next = 1;

  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: ProjectError) => void }
  >();

  private readonly profile: string;

  private readonly entry: string;

  constructor(
    profile: string,
    entry = path.join(__dirname, 'projectWorker.js'),
  ) {
    this.profile = profile;
    this.entry = entry;
  }

  private call<
    K extends
      | 'list'
      | 'create'
      | 'open'
      | 'save'
      | 'history'
      | 'recover'
      | 'copy'
      | 'addPNG'
      | 'readPNG'
      | 'generationSnapshot'
      | 'readManifest'
      | 'image',
  >(
    operation: K,
    args: Parameters<ProjectStore[K]>,
  ): Promise<ReturnType<ProjectStore[K]>> {
    if (this.closed || this.stopped)
      return Promise.reject(new ProjectError('PROJECT_SERVICE_STOPPED'));
    if (this.restarting)
      return Promise.reject(new ProjectError('PROJECT_BUSY'));
    if (this.pending.size >= 16)
      return Promise.reject(new ProjectError('PROJECT_BUSY'));
    if (!this.worker) {
      try {
        this.worker = new Worker(this.entry, {
          workerData: { profile: this.profile },
          ...(this.entry.endsWith('.ts')
            ? {
                env: {
                  ...process.env,
                  TS_NODE_PROJECT: path.resolve(
                    __dirname,
                    '../../../tsconfig.json',
                  ),
                },
                execArgv: [
                  '-r',
                  path.resolve(
                    __dirname,
                    '../../../node_modules/ts-node/register/transpile-only.js',
                  ),
                ],
              }
            : { execArgv: [] }),
        });
      } catch {
        this.stopped = true;
        return Promise.reject(new ProjectError('PROJECT_SERVICE_STOPPED'));
      }
      const activeWorker = this.worker;
      this.worker.on('message', (r) => {
        const task = this.pending.get(r.id);
        if (!task) return;
        this.pending.delete(r.id);
        if (r.ok) task.resolve(r.value);
        else task.reject(new ProjectError(r.code));
      });
      const fail = () => {
        if (this.worker !== activeWorker) return;
        this.stopped = true;
        this.pending.forEach((t) =>
          t.reject(new ProjectError('PROJECT_SERVICE_STOPPED')),
        );
        this.pending.clear();
      };
      this.worker.on('error', fail);
      this.worker.on('exit', fail);
    }
    const id = this.next;
    this.next += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ id, operation, args });
      } catch {
        this.pending.delete(id);
        reject(new ProjectError('PROJECT_IO'));
      }
    });
  }

  list() {
    return this.call('list', []);
  }

  create(content: unknown) {
    return this.call('create', [content]);
  }

  open(id: string) {
    return this.call('open', [id]);
  }

  save(id: string, revision: string, content: unknown) {
    return this.call('save', [id, revision, content]);
  }

  history(id: string) {
    return this.call('history', [id]);
  }

  recover(id: string, revision: string) {
    return this.call('recover', [id, revision]);
  }

  copy(id: string, revision: string, content: unknown) {
    return this.call('copy', [id, revision, content]);
  }

  // Main-only methods. No renderer endpoint accepts PNG bytes or a raw filesystem path.
  readManifest(id: string) {
    return this.call('readManifest', [id]);
  }

  image(id: string, imageId: string) {
    return this.call('image', [id, imageId]);
  }

  generationSnapshot(...args: Parameters<ProjectStore['generationSnapshot']>) {
    return this.call('generationSnapshot', args);
  }

  addPNG(...args: Parameters<ProjectStore['addPNG']>) {
    return this.call('addPNG', args);
  }

  readPNG(...args: Parameters<ProjectStore['readPNG']>) {
    return this.call('readPNG', args);
  }

  async restartStorage(): Promise<void> {
    if (this.closed || !this.stopped) throw new ProjectError('PROJECT_INPUT');
    if (this.restarting) throw new ProjectError('PROJECT_BUSY');
    this.restarting = true;
    const previous = this.worker;
    this.worker = undefined; // Old exit/error callbacks cannot stop the replacement.
    try {
      await previous?.terminate();
    } catch {
      /* Already stopped. Never replay a pending request. */
    } finally {
      this.restarting = false;
    }
    if (this.closed) throw new ProjectError('PROJECT_SERVICE_STOPPED');
    this.stopped = false;
    await this.list(); // Read-only readiness check; no previous write is retried.
  }

  close() {
    this.closed = true;
    this.pending.forEach((t) =>
      t.reject(new ProjectError('PROJECT_SERVICE_STOPPED')),
    );
    this.pending.clear();
    this.worker?.terminate().catch(() => {
      /* Pending calls already failed; never retry writes. */
    });
  }
}

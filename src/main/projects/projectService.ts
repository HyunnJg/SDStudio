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
      'list' | 'create' | 'open' | 'save' | 'history' | 'recover' | 'copy',
  >(
    operation: K,
    args: Parameters<ProjectStore[K]>,
  ): Promise<ReturnType<ProjectStore[K]>> {
    if (this.closed) return Promise.reject(new ProjectError('PROJECT_IO'));
    if (this.pending.size >= 16)
      return Promise.reject(new ProjectError('PROJECT_BUSY'));
    if (!this.worker) {
      this.worker = new Worker(this.entry, {
        workerData: { profile: this.profile },
        ...(this.entry.endsWith('.ts')
          ? {
              execArgv: [
                '-r',
                path.resolve('node_modules/ts-node/register/transpile-only.js'),
              ],
            }
          : { execArgv: [] }),
      });
      this.worker.on('message', (r) => {
        const task = this.pending.get(r.id);
        if (!task) return;
        this.pending.delete(r.id);
        if (r.ok) task.resolve(r.value);
        else task.reject(new ProjectError(r.code));
      });
      const fail = () => {
        this.closed = true;
        this.pending.forEach((t) => t.reject(new ProjectError('PROJECT_IO')));
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

  close() {
    this.closed = true;
    this.pending.forEach((t) => t.reject(new ProjectError('PROJECT_IO')));
    this.pending.clear();
    this.worker?.terminate().catch(() => {
      /* Pending calls already failed; never retry writes. */
    });
  }
}

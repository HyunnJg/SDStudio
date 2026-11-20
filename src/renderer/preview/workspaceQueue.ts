import {
  PreviewRequest,
  PreviewScenario,
  WorkspaceScene,
  projectWorkspaceDraft,
  randomWorkspaceSeed,
} from './workspaceDraft';

export interface WorkspaceJob {
  id: number;
  scene: WorkspaceScene;
  repeat: number;
  scenario: PreviewScenario;
  status: 'pending' | 'running' | 'done' | 'failed';
  request?: PreviewRequest;
  error?: unknown;
  resultId?: number;
}
export interface QueueSnapshot {
  jobs: WorkspaceJob[];
  running: boolean;
  active: boolean;
}
interface Options {
  render: (
    request: PreviewRequest,
    scenario: PreviewScenario,
  ) => Promise<string>;
  onResult: (
    image: string,
    request: PreviewRequest,
    sceneName: string,
  ) => number;
  onError: (error: unknown) => void;
  seed?: () => number;
  beforeRender?: () => Promise<void>;
}

/** Memory-only mock queue. Stop drains the current example; it starts no next job. */
export class WorkspaceQueue {
  private snapshot: QueueSnapshot = { jobs: [], running: false, active: false };

  private listeners = new Set<() => void>();

  private nextId = 1;

  private disposed = false;

  private usedSeeds = new Set<number>();

  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<QueueSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  reserve(
    scenes: WorkspaceScene[],
    repeats: number,
    scenario: PreviewScenario,
  ) {
    if (this.disposed || this.snapshot.active || this.snapshot.running)
      throw Object.assign(new Error('Queue is busy'), { code: 'QUEUE_BUSY' });
    if (
      !Number.isInteger(repeats) ||
      repeats < 1 ||
      repeats > 10 ||
      scenes.length === 0 ||
      scenes.length * repeats > 60
    )
      throw Object.assign(new Error('Invalid queue size'), {
        code: 'QUEUE_LIMIT',
      });
    // Validate every scene before changing the queue. Randomness is resolved at execution.
    scenes.forEach((scene) => projectWorkspaceDraft(scene.draft, 0));
    const jobs: WorkspaceJob[] = [];
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      scenes.forEach((scene) => {
        jobs.push({
          id: this.nextId,
          scene: structuredClone(scene),
          repeat,
          scenario,
          status: 'pending',
        });
        this.nextId += 1;
      });
    }
    this.usedSeeds.clear();
    this.update({ jobs }); // Explicit replacement, never an invisible append to old work.
  }

  start = async () => {
    if (this.disposed || this.snapshot.active || this.snapshot.running) return;
    this.update({ running: true });
    while (!this.disposed && this.snapshot.running) {
      const job = this.snapshot.jobs.find((item) => item.status === 'pending');
      if (!job) break;
      const replace = (patch: Partial<WorkspaceJob>) =>
        this.update({
          jobs: this.snapshot.jobs.map((item) =>
            item.id === job.id ? { ...item, ...patch } : item,
          ),
        });
      this.update({ active: true });
      replace({ status: 'running' });
      try {
        let seed = 0;
        if (job.scene.draft.seedMode === 'random') {
          seed = (this.options.seed ?? randomWorkspaceSeed)();
          // Bounded jobs, deterministic collision resolution; never retry randomness forever.
          while (this.usedSeeds.has(seed)) seed = (seed + 1) % 4294967296;
          this.usedSeeds.add(seed);
        }
        const request = projectWorkspaceDraft(job.scene.draft, seed);
        replace({ request });
        // Serial execution is intentional: one active mock job at a time.
        // eslint-disable-next-line no-await-in-loop
        await (this.options.beforeRender?.() ??
          new Promise<void>((resolve) => {
            setTimeout(resolve, 350);
          }));
        if (this.disposed) break;
        // eslint-disable-next-line no-await-in-loop
        const image = await this.options.render(request, job.scenario);
        if (this.disposed) break;
        const resultId = this.options.onResult(image, request, job.scene.name);
        replace({ status: 'done', resultId });
      } catch (error) {
        if (!this.disposed) {
          replace({ status: 'failed', error });
          this.update({ running: false });
          this.options.onError(error);
        }
      } finally {
        this.update({ active: false });
      }
    }
    this.update({ running: false });
  };

  stop = () => this.update({ running: false });

  clear = () => {
    if (!this.snapshot.active && !this.snapshot.running)
      this.update({ jobs: [] });
  };

  dispose = () => {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
  };
}

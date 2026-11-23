/* eslint import/prefer-default-export: off, max-classes-per-file: off */
import { randomUUID, createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { ProjectError, projectId, projectHash } from '../../workspaceProject';
import type { ProjectImageInput, ProjectContent } from '../../workspaceProject';
import type {
  GenerationPlan,
  GenerationCode,
  GeneratedProject,
  GenerationQueuePlan,
  GenerationQueueState,
  GenerationQueueStatus,
  GenerationFailure,
} from '../../workspaceGeneration';
import type { ProjectService } from '../projects/projectService';
import { NaiError } from './errors';
import { bindBasicGeneration } from './workspaceBinding';

export class GenerationError extends Error {
  readonly conflictSceneId?: string;

  constructor(
    readonly code: GenerationCode,
    readonly mayHaveReachedServer = false,
    readonly httpStatus?: number,
    readonly projectCode?: ProjectError['code'],
    readonly pendingResult?: true,
    conflictSceneId?: string,
  ) {
    super(code);
    if (
      code === 'QUEUE_INPUT_CHANGED' &&
      typeof conflictSceneId === 'string' &&
      /^[A-Za-z0-9_-]{1,100}$/.test(conflictSceneId)
    )
      this.conflictSceneId = conflictSceneId;
  }
}
interface Prepared {
  plan: GenerationPlan;
  id: string;
  revision: string;
  input: ProjectImageInput;
  body: Uint8Array;
  expires: number;
}
interface Pending {
  content: ProjectContent;
  imageId: string;
  id: string;
  revision: string;
  input: ProjectImageInput;
  bytes: Uint8Array;
  queueItemId?: string;
}
interface Reservation {
  state: GenerationQueueState;
  tasks: Prepared[];
}

interface Options {
  store: Pick<
    ProjectService,
    'readManifest' | 'image' | 'addPNG' | 'generationSnapshot' | 'create'
  >;
  offline: () => boolean;
  sendImage: (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>;
}
// Single-flight for this app. Every attempt requires a fresh, saved snapshot and explicit confirmation.
export class WorkspaceGeneration {
  private prepared?: Prepared;

  private pending?: Pending;

  private queue?: Reservation;

  private queueApproval?: {
    plan: GenerationQueuePlan;
    reservation: Reservation;
    expires: number;
  };

  private latest?: GeneratedProject;

  private controller?: AbortController;

  private working = false;

  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  status() {
    return { active: this.working, pending: !!this.pending };
  }

  hasWork() {
    return this.working || !!this.pending;
  }

  private online() {
    if (this.options.offline()) throw new GenerationError('OFFLINE');
  }

  private idle() {
    if (this.hasWork()) throw new GenerationError('GENERATION_BUSY');
  }

  async prepare(
    id: string,
    revision: string,
    sceneId: string,
  ): Promise<GenerationPlan> {
    this.online();
    this.idle();
    this.prepared = undefined;
    this.queueApproval = undefined;
    this.latest = undefined;
    projectId(id);
    projectHash(revision);
    this.working = true;
    try {
      const snapshot = await this.options.store.generationSnapshot(
        id,
        revision,
      );
      if (snapshot.revision !== revision)
        throw new ProjectError('PROJECT_CONFLICT');
      const scene = snapshot.project.scenes.find((s) => s.id === sceneId);
      if (!scene) throw new ProjectError('PROJECT_INPUT');
      let bound;
      try {
        bound = bindBasicGeneration(scene);
      } catch (error) {
        throw new GenerationError(
          error instanceof Error && error.message === 'INVALID_INPUT'
            ? 'INVALID_INPUT'
            : 'UNSUPPORTED_DRAFT',
        );
      }
      const { request, input } = bound;
      const body = Uint8Array.from(Buffer.from(JSON.stringify(request)));
      input.binding = {
        id: 'nai-v45-basic512-v1',
        requestHash: createHash('sha256').update(body).digest('hex'),
      };
      await this.options.store.generationSnapshot(id, revision, input);
      const plan: GenerationPlan = {
        ticket: randomUUID(),
        model: request.model,
        seed: request.parameters.seed,
        width: 512,
        height: 512,
        steps: 28,
        scale: 5,
        samples: 1,
      };
      this.prepared = {
        plan,
        id,
        revision,
        input,
        body,
        expires: Date.now() + 5 * 60 * 1000,
      };
      return { ...plan };
    } finally {
      this.working = false;
    }
  }

  async run(ticket: string, confirmed: boolean): Promise<GeneratedProject> {
    this.online();
    this.idle();
    const p = this.prepared;
    if (
      !p ||
      p.plan.ticket !== ticket ||
      confirmed !== true ||
      Date.now() > p.expires
    )
      throw new GenerationError('CONFIRMATION_EXPIRED');
    this.prepared = undefined; // Claim before any await. Never replay after errors/cancel/restart.
    this.working = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      return await this.execute(p, controller);
    } finally {
      this.controller = undefined;
      this.working = false;
    }
  }

  // Single and repeated generation share the same preflight, transport, pending and persistence path.
  private async execute(
    p: Prepared,
    controller: AbortController,
    queueItemId?: string,
  ): Promise<GeneratedProject> {
    let transportStarted = false;
    try {
      const current = await this.options.store.generationSnapshot(
        p.id,
        p.revision,
        p.input,
      );
      if (current.revision !== p.revision)
        throw new ProjectError('PROJECT_CONFLICT');
      this.online();
      if (controller.signal.aborted) throw new GenerationError('CANCELLED');
      if (queueItemId)
        this.queue!.state.items.find(
          (item) => item.id === queueItemId,
        )!.status = 'running';
      transportStarted = true;
      const bytes = await this.options.sendImage(p.body, controller.signal);
      this.pending = {
        content: {
          name: current.project.name,
          selectedSceneId: p.input.sceneId,
          scenes: current.project.scenes,
        },
        imageId: randomUUID(),
        id: p.id,
        revision: p.revision,
        input: p.input,
        bytes: Uint8Array.from(bytes),
        queueItemId,
      };
      // Queue results append to the latest manifest without replacing its input. A race still fails closed into pending.
      const revision = queueItemId
        ? (await this.options.store.readManifest(p.id)).revision
        : p.revision;
      return await this.persist(revision);
    } catch (error) {
      if (this.pending && !(error instanceof GenerationError))
        throw new GenerationError(
          'RESULT_SAVE_FAILED',
          true,
          undefined,
          error instanceof ProjectError ? error.code : 'PROJECT_IO',
          true,
        );
      if (error instanceof NaiError)
        throw new GenerationError(
          error.code,
          error.mayHaveReachedServer,
          error.httpStatus,
        );
      if (
        !(error instanceof GenerationError) &&
        !(error instanceof ProjectError) &&
        transportStarted
      )
        throw new GenerationError('NETWORK', true);
      throw error;
    }
  }

  private saved(result: GeneratedProject) {
    const itemId = this.pending?.queueItemId;
    if (itemId && this.queue) {
      if (result.snapshot.project.id !== this.queue.state.projectId) {
        // An explicit result-only new project ends the old reservation. Its image UUID is not a reference in the old manifest.
        this.queue = undefined;
        this.queueApproval = undefined;
        this.latest = undefined;
      } else {
        const item = this.queue.state.items.find((i) => i.id === itemId)!;
        item.status = 'done';
        item.imageId = result.imageId;
        delete item.error;
        if (this.queue.state.stoppedItemId === item.id)
          delete this.queue.state.stoppedItemId;
        this.latest = result;
      }
    }
    this.pending = undefined;
    return result;
  }

  private async persist(revision: string): Promise<GeneratedProject> {
    const p = this.pending!;
    try {
      const snapshot = await this.options.store.addPNG(
        p.id,
        revision,
        p.input,
        p.bytes,
        p.imageId,
      );
      const imageId =
        snapshot.project.images[snapshot.project.images.length - 1].id;
      return this.saved({ snapshot, imageId });
    } catch (error) {
      throw new GenerationError(
        'RESULT_SAVE_FAILED',
        true,
        undefined,
        error instanceof ProjectError ? error.code : 'PROJECT_IO',
        true,
      );
    }
  }

  async retrySave(asNewProject = false): Promise<GeneratedProject> {
    if (this.working || !this.pending)
      throw new GenerationError('GENERATION_BUSY');
    this.working = true;
    try {
      if (asNewProject === true) {
        const next = await this.options.store.create({
          ...this.pending.content,
          name: `${this.pending.content.name.slice(0, 105)} (이번 결과)`,
        });
        this.pending.id = next.project.id;
        this.pending.revision = next.revision;
        return await this.persist(next.revision);
      }
      const snapshot = await this.options.store.readManifest(this.pending.id);
      // An ambiguous prior write may already contain this result. Do not append twice.
      const existing = snapshot.project.images.find(
        (i) => i.id === this.pending!.imageId,
      );
      if (existing) {
        if (
          existing.sha256 !==
          createHash('sha256').update(this.pending.bytes).digest('hex')
        )
          throw new ProjectError('PROJECT_CORRUPT');
        await this.options.store.image(this.pending.id, existing.id); // Validate only this already-committed result before releasing the retained PNG.
        return this.saved({ snapshot, imageId: existing.id });
      }
      return await this.persist(snapshot.revision);
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      throw new GenerationError(
        'RESULT_SAVE_FAILED',
        true,
        undefined,
        error instanceof ProjectError ? error.code : 'PROJECT_IO',
        true,
      );
    } finally {
      this.working = false;
    }
  }

  excludePendingScene(
    queueId: string,
    sceneId: string,
    confirmed: boolean,
  ): GenerationQueueStatus {
    this.idle();
    projectId(queueId);
    const q = this.queue;
    const stop = q?.state.items.find(
      (item) => item.id === q.state.stoppedItemId,
    );
    if (
      !q ||
      q.state.id !== queueId ||
      confirmed !== true ||
      stop?.error?.code !== 'QUEUE_INPUT_CHANGED' ||
      stop.error.conflictSceneId !== sceneId ||
      !q.state.items.some(
        (item) => item.sceneId === sceneId && item.status === 'pending',
      )
    )
      throw new GenerationError('INVALID_INPUT');
    q.state.items.forEach((item) => {
      if (item.sceneId === sceneId && item.status === 'pending') {
        item.status = 'skipped';
        delete item.error;
      }
    });
    this.prepared = undefined;
    this.queueApproval = undefined;
    delete q.state.stoppedItemId;
    return this.queueStatus(); // Local reservation edit only. Never starts a request or edits a project file.
  }

  clearQueue() {
    this.idle();
    this.queueApproval = undefined;
    this.queue = undefined;
    this.latest = undefined;
  }

  queueStatus(
    knownRevision?: string,
    includeFinished = false,
  ): GenerationQueueStatus {
    if (knownRevision !== undefined) projectHash(knownRevision);
    return {
      ...(this.queue ? { queue: structuredClone(this.queue.state) } : {}),
      ...(this.latest &&
      (this.queue?.state.running || includeFinished) &&
      this.latest.snapshot.revision !== knownRevision
        ? { latest: structuredClone(this.latest) }
        : {}),
    };
  }

  private approve(reservation: Reservation): GenerationQueuePlan {
    const items = reservation.state.items.filter(
      (item) => item.status === 'pending',
    );
    if (!items.length) throw new GenerationError('INVALID_INPUT');
    const plan: GenerationQueuePlan = {
      ticket: randomUUID(),
      queueId: reservation.state.id,
      total: items.length,
      items: structuredClone(items),
      model: 'nai-diffusion-4-5-full',
      width: 512,
      height: 512,
      steps: 28,
      scale: 5,
    };
    this.queueApproval = {
      plan,
      reservation,
      expires: Date.now() + 5 * 60 * 1000,
    };
    return structuredClone(plan);
  }

  async prepareQueue(
    id: string,
    revision: string,
    sceneIds: string[],
    repeats: number,
  ): Promise<GenerationQueuePlan> {
    this.online();
    this.idle();
    this.prepared = undefined;
    this.queueApproval = undefined;
    projectId(id);
    projectHash(revision);
    if (
      !Array.isArray(sceneIds) ||
      !sceneIds.length ||
      sceneIds.length > 60 ||
      new Set(sceneIds).size !== sceneIds.length ||
      !Number.isInteger(repeats) ||
      repeats < 1
    )
      throw new GenerationError('INVALID_INPUT');
    if (repeats > 60 || sceneIds.length * repeats > 60)
      throw new GenerationError('QUEUE_LIMIT');
    if (
      sceneIds.some(
        (sceneId) => typeof sceneId !== 'string' || sceneId.length > 128,
      )
    )
      throw new GenerationError('INVALID_INPUT');
    this.working = true;
    try {
      const snapshot = await this.options.store.generationSnapshot(
        id,
        revision,
      );
      const scenes = snapshot.project.scenes.filter((scene) =>
        sceneIds.includes(scene.id),
      );
      if (scenes.length !== sceneIds.length)
        throw new GenerationError('INVALID_INPUT');
      if (snapshot.project.images.length + scenes.length * repeats > 120)
        throw new GenerationError('QUEUE_LIMIT');
      const tasks: Prepared[] = [];
      const items: GenerationQueueState['items'] = [];
      const seeds = new Set<number>();
      let bodyBytes = 0;
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
          const scene = scenes[sceneIndex];
          let bound;
          try {
            bound = bindBasicGeneration(scene);
          } catch (error) {
            throw new GenerationError(
              error instanceof Error && error.message === 'INVALID_INPUT'
                ? 'INVALID_INPUT'
                : 'UNSUPPORTED_DRAFT',
            );
          }
          let { seed } = bound.input;
          if (scene.draft.seedMode === 'random') {
            while (seeds.has(seed)) seed = (seed + 1) % 4294967296;
            seeds.add(seed);
            bound.input.seed = seed;
            bound.request.parameters.seed = seed;
          }
          const body = Uint8Array.from(
            Buffer.from(JSON.stringify(bound.request)),
          );
          bodyBytes += body.byteLength;
          if (bodyBytes > 8 * 1024 * 1024)
            throw new GenerationError('QUEUE_LIMIT');
          bound.input.binding = {
            id: 'nai-v45-basic512-v1',
            requestHash: createHash('sha256').update(body).digest('hex'),
          };
          const task = {
            id,
            revision,
            input: bound.input,
            body,
            expires: 0,
            plan: {
              ticket: randomUUID(),
              model: bound.request.model,
              seed,
              width: 512 as const,
              height: 512 as const,
              steps: 28 as const,
              scale: 5 as const,
              samples: 1 as const,
            },
          };
          tasks.push(task);
          items.push({
            id: task.plan.ticket,
            sceneId: scene.id,
            sceneName: scene.name,
            repeat,
            seed,
            status: 'pending',
          });
        }
      }
      // Bind all scenes before making the new reservation visible. The final preflight rechecks the saved revision.
      await this.options.store.generationSnapshot(id, revision, tasks[0].input);
      const reservation: Reservation = {
        state: {
          id: randomUUID(),
          projectId: id,
          running: false,
          stopped: false,
          items,
        },
        tasks,
      };
      const plan = this.approve(reservation);
      this.queue = reservation;
      this.latest = undefined;
      return plan;
    } finally {
      this.working = false;
    }
  }

  async prepareRemaining(
    queueId: string,
    id: string,
    revision: string,
  ): Promise<GenerationQueuePlan> {
    this.online();
    this.idle();
    this.prepared = undefined;
    this.queueApproval = undefined;
    projectId(queueId);
    projectId(id);
    projectHash(revision);
    const q = this.queue;
    if (!q || q.state.id !== queueId || q.state.projectId !== id)
      throw new GenerationError('INVALID_INPUT');
    delete q.state.stoppedItemId;
    this.working = true;
    try {
      const current = await this.options.store.generationSnapshot(id, revision);
      WorkspaceGeneration.checkQueuedInputs(q, current.project);
      const count = q.state.items.filter((i) => i.status === 'pending').length;
      if (current.project.images.length + count > 120)
        throw new GenerationError('QUEUE_LIMIT');
      const plan = this.approve(q);
      delete q.state.stoppedItemId;
      return plan;
    } catch (error) {
      const item = q.state.items.find(
        (value) =>
          value.status === 'pending' &&
          (!(error instanceof GenerationError) ||
            !error.conflictSceneId ||
            value.sceneId === error.conflictSceneId),
      );
      if (item) {
        item.error = WorkspaceGeneration.failure(error);
        q.state.stoppedItemId = item.id;
        q.state.stopped = true;
      }
      throw error;
    } finally {
      this.working = false;
    }
  }

  /* eslint-disable no-await-in-loop, no-continue -- Billed requests run serially and skip only tasks already resolved. */
  async runQueue(
    ticket: string,
    confirmed: boolean,
  ): Promise<GenerationQueueStatus> {
    this.online();
    this.idle();
    const a = this.queueApproval;
    if (
      !a ||
      a.plan.ticket !== ticket ||
      confirmed !== true ||
      Date.now() > a.expires
    )
      throw new GenerationError('CONFIRMATION_EXPIRED');
    this.queueApproval = undefined;
    this.prepared = undefined; // Claim the whole approval before the first await.
    const q = a.reservation;
    this.queue = q;
    this.working = true;
    q.state.running = true;
    q.state.stopped = false;
    delete q.state.stoppedItemId;
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (let index = 0; index < q.tasks.length; index += 1) {
        const item = q.state.items[index];
        if (item.status !== 'pending') continue;
        if (q.state.stopped || controller.signal.aborted) break;
        item.status = 'preparing';
        delete item.error;
        try {
          const current = await this.options.store.readManifest(
            q.state.projectId,
          );
          WorkspaceGeneration.checkQueuedInputs(q, current.project);
          if (q.state.stopped || controller.signal.aborted) {
            item.status = 'pending';
            break;
          }
          const task = { ...q.tasks[index], revision: current.revision };
          await this.execute(task, controller, item.id);
          // Response retention/storage is completed even if a stop arrived after the server returned.
          if (q.state.stopped || controller.signal.aborted) break;
        } catch (error) {
          const failure = WorkspaceGeneration.failure(error);
          if (
            item.status === 'preparing' &&
            !failure.mayHaveReachedServer &&
            !this.pending
          ) {
            item.status = 'pending';
            item.error = failure; // It was never handed to sendImage. Continuation still requires a new approval.
          } else {
            item.status = this.pending ? 'result-pending' : 'failed';
            item.error = failure;
          }
          q.state.stoppedItemId = item.id;
          q.state.stopped = true;
          break; // Never retry a failed/ambiguous send or skip forward automatically.
        }
      }
    } finally {
      q.state.running = false;
      this.working = false;
      this.controller = undefined;
    }
    return this.queueStatus(undefined, true);
  }

  /* eslint-enable no-await-in-loop, no-continue */

  private static checkQueuedInputs(q: Reservation, current: ProjectContent) {
    q.tasks.forEach((task, index) => {
      const { status } = q.state.items[index];
      if (status !== 'pending' && status !== 'preparing') return;
      const scene = current.scenes.find(
        (value) => value.id === task.input.sceneId,
      );
      if (!scene || !isDeepStrictEqual(scene.draft, task.input.draft))
        throw new GenerationError(
          'QUEUE_INPUT_CHANGED',
          false,
          undefined,
          undefined,
          undefined,
          task.input.sceneId,
        );
    });
  }

  private static failure(error: unknown): GenerationFailure {
    if (error instanceof GenerationError)
      return {
        ok: false,
        code: error.code,
        mayHaveReachedServer: error.mayHaveReachedServer,
        ...(error.httpStatus !== undefined
          ? { httpStatus: error.httpStatus }
          : {}),
        ...(error.projectCode ? { projectCode: error.projectCode } : {}),
        ...(error.pendingResult ? { pendingResult: true as const } : {}),
        ...(error.conflictSceneId
          ? { conflictSceneId: error.conflictSceneId }
          : {}),
      };
    return {
      ok: false,
      code: error instanceof ProjectError ? error.code : 'INVALID_INPUT',
      mayHaveReachedServer: false,
    };
  }

  cancel() {
    this.prepared = undefined;
    this.queueApproval = undefined;
    if (this.queue?.state.running) this.queue.state.stopped = true;
    this.controller?.abort();
  }

  discardPending() {
    if (this.working) throw new GenerationError('GENERATION_BUSY');
    const item = this.queue?.state.items.find(
      (i) => i.id === this.pending?.queueItemId,
    );
    if (item) {
      item.status = 'failed';
      delete item.error?.pendingResult;
      if (this.queue?.state.stoppedItemId === item.id)
        delete this.queue.state.stoppedItemId;
    }
    this.pending = undefined;
  }

  async image(id: string, imageId: string): Promise<Uint8Array> {
    projectId(id);
    projectId(imageId);
    return this.options.store.image(id, imageId);
  }
}

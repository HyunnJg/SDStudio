/* eslint import/prefer-default-export: off, max-classes-per-file: off, no-await-in-loop: off -- Approved queue jobs are bound serially within the memory limit. */
import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID, randomInt, createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import {
  DEFAULT_QUEUE_INTERVAL,
  isQueueInterval,
} from '../../workspaceGeneration';
import {
  PROJECT_LIMITS,
  ProjectError,
  projectId,
  projectHash,
} from '../../workspaceProject';
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
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';
import {
  GENERATION_BODY_LIMIT,
  REFERENCE_LIMITS,
  sceneReferences,
} from '../../workspaceReference';
import type { ReferenceAsset, ImagePurpose } from '../../workspaceReference';
import type { ProjectService } from '../projects/projectService';
import { NaiError } from './errors';
import { bindBasicGeneration } from './workspaceBinding';
import { GenerationJournal } from './generationJournal';
import type { Pending, RequestRecord } from './generationJournal';
import { draftSize } from '../../workspaceCatalog';

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
interface Reservation {
  state: GenerationQueueState;
  tasks: (Omit<Prepared, 'body'> & {
    sourceDraft: ProjectImageInput['draft'];
  })[];
}

interface Options {
  journal?: GenerationJournal;
  store: Pick<
    ProjectService,
    'readManifest' | 'image' | 'addPNG' | 'generationSnapshot' | 'create'
  > &
    Partial<
      Pick<
        ProjectService,
        'importReference' | 'referenceBytes' | 'referenceImage'
      >
    >;
  offline: () => boolean;
  sendImage: (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>;
}
// Single-flight for this app. Every attempt requires a fresh, saved snapshot and explicit confirmation.
export class WorkspaceGeneration {
  private prepared?: Prepared;

  private pending?: Pending;

  private interruption?: string;

  private queue?: Reservation;

  private queueApproval?: {
    plan: GenerationQueuePlan;
    reservation: Reservation;
    expires: number;
  };

  private latest?: GeneratedProject;

  private controller?: AbortController;

  private working = false;

  private lastRequestFinished?: number;

  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    try {
      const saved = options.journal?.read();
      if (saved?.bytes) this.pending = { ...saved.record, bytes: saved.bytes };
      else if (saved) {
        const { content, input } = saved.record;
        const name =
          content.scenes.find((scene) => scene.id === input.sceneId)?.name ??
          input.sceneId;
        this.interruption = `‘${content.name} / ${name}’ (시드 ${input.seed}) 요청의 응답을 확인하지 못했습니다.`;
      }
    } catch {
      this.interruption = '이전 생성 복구 기록을 읽을 수 없습니다.';
    }
  }

  status() {
    return {
      active: this.working,
      pending: !!this.pending,
      ...(this.interruption && { interruption: this.interruption }),
    };
  }

  hasWork() {
    return this.working || !!this.pending;
  }

  async withProjectMutation<T>(
    action: () => Promise<T>,
    trashedProjectId?: string,
  ): Promise<T> {
    if (this.hasWork()) throw new ProjectError('PROJECT_BUSY');
    this.working = true; // Claim synchronously: prepare/run/import cannot race an asynchronous worker mutation.
    this.prepared = undefined;
    this.queueApproval = undefined;
    this.latest = undefined;
    try {
      const result = await action();
      if (trashedProjectId && this.queue?.state.projectId === trashedProjectId)
        this.queue = undefined;
      return result;
    } finally {
      this.working = false;
    }
  }

  private online() {
    if (this.options.offline()) throw new GenerationError('OFFLINE');
  }

  private idle() {
    if (this.interruption || this.hasWork())
      throw new GenerationError('GENERATION_BUSY');
  }

  async importReference(
    id: string,
    revision: string,
    png: Uint8Array,
    purpose: ImagePurpose = 'reference',
    referenceTarget: string | undefined = undefined,
  ): Promise<{ asset: ReferenceAsset; preview: Uint8Array }> {
    this.idle();
    if (!this.options.store.importReference)
      throw new GenerationError('INVALID_INPUT');
    this.prepared = undefined;
    this.queueApproval = undefined;
    this.working = true;
    try {
      const asset = await this.options.store.importReference(
        id,
        revision,
        png,
        purpose,
        referenceTarget,
      );
      if (!this.options.store.referenceBytes)
        throw new GenerationError('INVALID_INPUT');
      const preview = await this.options.store.referenceBytes(id, asset);
      return { asset, preview };
    } finally {
      this.working = false;
    }
  }

  async referenceImage(
    id: string,
    sceneId: string,
    purpose?: ImagePurpose,
    referenceId?: string,
  ): Promise<Uint8Array> {
    if (!this.options.store.referenceImage)
      throw new GenerationError('INVALID_INPUT');
    return this.options.store.referenceImage(id, sceneId, purpose, referenceId);
  }

  private async inputImages(id: string, scene: WorkspaceScene) {
    const { reference, img2img, inpaintSource, inpaintMask, family } =
      scene.draft;
    if (!reference && !img2img && !inpaintSource && !inpaintMask) return {};
    if (inpaintSource || inpaintMask) {
      const size = draftSize(scene.draft);
      if (
        [inpaintSource, inpaintMask].some(
          (asset) =>
            asset &&
            (asset.width !== size.width || asset.height !== size.height),
        )
      )
        throw new GenerationError('INPAINT_SIZE_MISMATCH');
    }
    if ((reference || img2img) && family !== 'v5')
      throw new GenerationError('UNSUPPORTED_DRAFT');
    const { store } = this.options;
    if (!store.referenceBytes) throw new GenerationError('INVALID_INPUT');
    const references = sceneReferences(scene.draft);
    if (references.length > REFERENCE_LIMITS.cards)
      throw new GenerationError('PROJECT_REFERENCE_COUNT');
    const base64Length = [
      ...references,
      img2img,
      inpaintSource,
      inpaintMask,
    ].reduce(
      (sum, asset) => sum + (asset ? 4 * Math.ceil(asset.uploadBytes / 3) : 0),
      0,
    );
    if (base64Length > GENERATION_BODY_LIMIT)
      throw new GenerationError('GENERATION_BODY_LIMIT');
    const uploads: Uint8Array[] = [];
    for (let index = 0; index < references.length; index += 1)
      uploads.push(await store.referenceBytes(id, references[index]));
    return {
      references: uploads,
      inpaintSource:
        inpaintSource && (await store.referenceBytes(id, inpaintSource)),
      inpaintMask: inpaintMask && (await store.referenceBytes(id, inpaintMask)),
      img2img: img2img && (await store.referenceBytes(id, img2img)),
    };
  }

  private async bind(
    id: string,
    scene: WorkspaceScene,
    chooseSeed?: () => number,
  ) {
    return bindBasicGeneration(
      scene,
      chooseSeed,
      await this.inputImages(id, scene),
    );
  }

  private static imageSettings(scene: WorkspaceScene) {
    const v = scene.draft.img2img;
    const [first, ...additional] = sceneReferences(scene.draft).map(
      ({ id, uploadHash, role, strength, preferSameOutfit }) => ({
        id,
        uploadHash,
        role,
        strength,
        preferSameOutfit,
      }),
    );
    return {
      ...(scene.draft.family === 'v5' && scene.draft.transparentBackground
        ? { transparentBackground: true as const }
        : {}),
      ...(v && { img2img: { strength: v.strength, noise: v.noise } }),
      ...(first && {
        reference: { ...first, count: additional.length + 1, additional },
      }),
    };
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
        bound = await this.bind(id, scene);
      } catch (error) {
        if (error instanceof ProjectError || error instanceof GenerationError)
          throw error;
        throw new GenerationError(
          error instanceof Error && error.message === 'INVALID_INPUT'
            ? 'INVALID_INPUT'
            : 'UNSUPPORTED_DRAFT',
        );
      }
      const { request, input } = bound;
      const body = Uint8Array.from(Buffer.from(JSON.stringify(request)));
      if (body.byteLength > GENERATION_BODY_LIMIT)
        throw new GenerationError('GENERATION_BODY_LIMIT');
      input.binding = {
        id: bound.bindingId,
        requestHash: createHash('sha256').update(body).digest('hex'),
      };
      await this.options.store.generationSnapshot(id, revision, input);
      const plan: GenerationPlan = {
        ticket: randomUUID(),
        model: request.model,
        seed: request.parameters.seed,
        width: request.parameters.width,
        height: request.parameters.height,
        steps: request.parameters.steps,
        scale: request.parameters.scale,
        ...(bound.characterCount ? { characters: bound.characterCount } : {}),
        ...WorkspaceGeneration.imageSettings(scene),
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
      const record: RequestRecord = {
        content: {
          name: current.project.name,
          selectedSceneId: p.input.sceneId,
          scenes: current.project.scenes,
        },
        imageId: randomUUID(),
        id: p.id,
        revision: p.revision,
        input: p.input,
      };
      try {
        this.options.journal?.write(record);
      } catch {
        throw new ProjectError('PROJECT_IO');
      }
      transportStarted = true;
      let bytes: Uint8Array;
      try {
        bytes = await this.options.sendImage(p.body, controller.signal);
      } finally {
        this.lastRequestFinished = performance.now();
      }
      this.pending = { ...record, bytes: Uint8Array.from(bytes), queueItemId };
      this.options.journal?.write(record, bytes);
      // Queue results append to the latest manifest without replacing its input. A race still fails closed into pending.
      const revision = queueItemId
        ? (await this.options.store.readManifest(p.id)).revision
        : p.revision;
      return await this.persist(revision);
    } catch (error) {
      if (transportStarted && !this.pending) this.options.journal?.clear();
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
    this.options.journal?.clear();
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
      const snapshot = await Promise.resolve()
        .then(() => this.options.store.readManifest(this.pending!.id))
        .catch((error) => {
          if (!asNewProject) throw error;
          return undefined;
        });
      // An ambiguous prior write may already contain this result. Do not append twice.
      const existing = snapshot?.project.images.find(
        (i) => i.id === this.pending!.imageId,
      );
      if (snapshot && existing) {
        if (
          existing.sha256 !==
          createHash('sha256').update(this.pending.bytes).digest('hex')
        )
          throw new ProjectError('PROJECT_CORRUPT');
        await this.options.store.image(this.pending.id, existing.id); // Validate only this already-committed result before releasing the retained PNG.
        return this.saved({ snapshot, imageId: existing.id });
      }
      if (asNewProject === true) {
        const next = await this.options.store.create(
          {
            ...this.pending.content,
            name: `${this.pending.content.name.slice(0, 105)} (이번 결과)`,
          },
          this.pending.id,
        );
        this.options.journal?.write(
          { ...this.pending, id: next.project.id, revision: next.revision },
          this.pending.bytes,
        );
        this.pending.id = next.project.id;
        this.pending.revision = next.revision;
        return await this.persist(next.revision);
      }
      if (!snapshot) throw new ProjectError('PROJECT_NOT_FOUND');
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
    // The current preflight may have detected a different scene's changed input.
    // Excluding that scene resolves this stop without altering the current job.
    delete stop.error;
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
    const first = reservation.tasks.find(
      (task) => task.plan.ticket === items[0].id,
    )!.plan;
    const fixedScenes = new Set(
      reservation.tasks
        .filter((task) => task.sourceDraft.seedMode === 'fixed')
        .map((task) => task.input.sceneId),
    );
    const pendingFixed = items
      .filter((item) => fixedScenes.has(item.sceneId))
      .map((item) => item.sceneId);
    const plan: GenerationQueuePlan = {
      ...(new Set(pendingFixed).size < pendingFixed.length
        ? { repeatsFixedSeed: true as const }
        : {}),
      ticket: randomUUID(),
      queueId: reservation.state.id,
      total: items.length,
      intervalSeconds: reservation.state.intervalSeconds,
      items: structuredClone(items),
      model: first.model,
      width: first.width,
      height: first.height,
      steps: first.steps,
      scale: first.scale,
      settings: [
        ...new Map(
          items.map((item) => [JSON.stringify(item.settings), item.settings!]),
        ).values(),
      ],
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
    intervalSeconds = DEFAULT_QUEUE_INTERVAL,
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
      !isQueueInterval(intervalSeconds) ||
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
      if (
        snapshot.project.images.length + scenes.length * repeats >
        PROJECT_LIMITS.results
      )
        throw new ProjectError('PROJECT_RESULT_LIMIT');
      const tasks: Reservation['tasks'] = [];
      const items: GenerationQueueState['items'] = [];
      const seeds = new Set<number>();
      const chooseSeed = () => {
        let candidate = randomInt(4294967296);
        while (seeds.has(candidate)) candidate = (candidate + 1) % 4294967296;
        seeds.add(candidate);
        return candidate;
      };
      // Draw seeds in execution order. Read one scene's original/derivative once for all its reservations.
      const scheduledSeeds = Array.from(
        { length: scenes.length * repeats },
        (_, index) => {
          const { draft } = scenes[index % scenes.length];
          return draft.seedMode === 'random'
            ? chooseSeed()
            : Number(draft.seed);
        },
      );
      for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
        const scene = scenes[sceneIndex];
        const image = await this.inputImages(id, scene);
        const imageSettings = WorkspaceGeneration.imageSettings(scene);
        for (let repeat = 1; repeat <= repeats; repeat += 1) {
          const index = (repeat - 1) * scenes.length + sceneIndex;
          let bound;
          try {
            bound = bindBasicGeneration(
              scene,
              () => scheduledSeeds[index],
              image,
            );
          } catch (error) {
            if (
              error instanceof ProjectError ||
              error instanceof GenerationError
            )
              throw error;
            throw new GenerationError(
              error instanceof Error && error.message === 'INVALID_INPUT'
                ? 'INVALID_INPUT'
                : 'UNSUPPORTED_DRAFT',
            );
          }
          const { seed } = bound.input;
          const body = Buffer.from(JSON.stringify(bound.request));
          if (body.byteLength > GENERATION_BODY_LIMIT)
            throw new GenerationError('GENERATION_BODY_LIMIT');
          bound.input.binding = {
            id: bound.bindingId,
            requestHash: createHash('sha256').update(body).digest('hex'),
          };
          const task = {
            id,
            revision,
            input: bound.input,
            sourceDraft: scene.draft,
            expires: 0,
            plan: {
              ticket: randomUUID(),
              model: bound.request.model,
              seed,
              width: bound.request.parameters.width,
              height: bound.request.parameters.height,
              steps: bound.request.parameters.steps,
              scale: bound.request.parameters.scale,
              ...(bound.characterCount
                ? { characters: bound.characterCount }
                : {}),
              ...imageSettings,
              samples: 1 as const,
            },
          };
          tasks[index] = task;
          items[index] = {
            id: task.plan.ticket,
            settings: {
              ...imageSettings,
              model: task.plan.model,
              width: task.plan.width,
              height: task.plan.height,
              steps: task.plan.steps,
              scale: task.plan.scale,
              ...(task.plan.characters
                ? { characters: task.plan.characters }
                : {}),
            },
            sceneId: scene.id,
            sceneName: scene.name,
            repeat,
            seed,
            status: 'pending',
          };
        }
      }
      // Bind all scenes before making the new reservation visible. The final preflight rechecks the saved revision.
      await this.options.store.generationSnapshot(id, revision, tasks[0].input);
      const reservation: Reservation = {
        state: {
          id: randomUUID(),
          projectId: id,
          intervalSeconds,
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
    intervalSeconds?: number,
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
    const interval =
      intervalSeconds === undefined ? q.state.intervalSeconds : intervalSeconds;
    if (!isQueueInterval(interval)) throw new GenerationError('INVALID_INPUT');
    delete q.state.stoppedItemId;
    this.working = true;
    try {
      const current = await this.options.store.generationSnapshot(id, revision);
      WorkspaceGeneration.checkQueuedInputs(q, current.project);
      const count = q.state.items.filter((i) => i.status === 'pending').length;
      if (current.project.images.length + count > PROJECT_LIMITS.results)
        throw new ProjectError('PROJECT_RESULT_LIMIT');
      q.state.intervalSeconds = interval;
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
        if (this.lastRequestFinished !== undefined) {
          const remaining =
            this.lastRequestFinished +
            q.state.intervalSeconds * 1000 -
            performance.now();
          if (remaining > 0) {
            q.state.nextRequestAt = Date.now() + remaining;
            try {
              await wait(remaining, undefined, { signal: controller.signal });
            } catch (error) {
              if (!controller.signal.aborted) throw error;
            } finally {
              delete q.state.nextRequestAt;
            }
            if (controller.signal.aborted) break;
          }
        }
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
          const scene = current.project.scenes.find(
            (s) => s.id === item.sceneId,
          )!;
          const { request } = await this.bind(
            task.id,
            scene,
            () => task.input.seed,
          );
          const body = Buffer.from(JSON.stringify(request));
          if (
            createHash('sha256').update(body).digest('hex') !==
            task.input.binding?.requestHash
          )
            throw new ProjectError('PROJECT_CONFLICT');
          await this.execute({ ...task, body }, controller, item.id);
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
      if (!scene || !isDeepStrictEqual(scene.draft, task.sourceDraft))
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
    this.options.journal?.clear();
    this.interruption = undefined;
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

/* eslint import/prefer-default-export: off, max-classes-per-file: off */
import { randomUUID, createHash } from 'crypto';
import { ProjectError, projectId, projectHash } from '../../workspaceProject';
import type { ProjectImageInput, ProjectContent } from '../../workspaceProject';
import type {
  GenerationPlan,
  GenerationCode,
  GeneratedProject,
} from '../../workspaceGeneration';
import type { ProjectService } from '../projects/projectService';
import { NaiError } from './errors';
import { bindBasicGeneration } from './workspaceBinding';

export class GenerationError extends Error {
  constructor(
    readonly code: GenerationCode,
    readonly mayHaveReachedServer = false,
    readonly httpStatus?: number,
    readonly projectCode?: ProjectError['code'],
    readonly pendingResult?: true,
  ) {
    super(code);
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
      transportStarted = true;
      const bytes = await this.options.sendImage(p.body, controller.signal);
      // A valid completed response is retained even if cancel arrives during persistence.
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
      };
      return await this.persist(p.revision);
    } catch (error) {
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
    } finally {
      this.controller = undefined;
      this.working = false;
    }
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
      this.pending = undefined;
      return { snapshot, imageId };
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
        this.pending = undefined;
        return { snapshot, imageId: existing.id };
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

  cancel() {
    this.prepared = undefined;
    this.controller?.abort();
  }

  discardPending() {
    if (this.working) throw new GenerationError('GENERATION_BUSY');
    this.pending = undefined;
  }

  async image(id: string, imageId: string): Promise<Uint8Array> {
    projectId(id);
    projectId(imageId);
    return this.options.store.image(id, imageId);
  }
}

import type { NaiErrorCode } from './naiAuth';
import type { ProjectErrorCode, ProjectSnapshot } from './workspaceProject';

export type GenerationCode =
  | NaiErrorCode
  | ProjectErrorCode
  | 'GENERATION_BUSY'
  | 'CONFIRMATION_EXPIRED'
  | 'UNSUPPORTED_DRAFT'
  | 'RESULT_SAVE_FAILED';
export interface GenerationFailure {
  ok: false;
  code: GenerationCode;
  mayHaveReachedServer: boolean;
  httpStatus?: number;
  projectCode?: ProjectErrorCode;
  pendingResult?: true;
}
export type GenerationReply<T> = { ok: true; value: T } | GenerationFailure;
export interface GenerationPlan {
  ticket: string;
  model: 'nai-diffusion-4-5-full';
  seed: number;
  width: 512;
  height: 512;
  steps: 28;
  scale: 5;
  samples: 1;
}
export interface GeneratedProject {
  snapshot: ProjectSnapshot;
  imageId: string;
}
export interface GenerationClient {
  status(): Promise<GenerationReply<{ active: boolean; pending: boolean }>>;
  prepare(
    id: string,
    revision: string,
    sceneId: string,
  ): Promise<GenerationReply<GenerationPlan>>;
  run(
    ticket: string,
    webCostConfirmed: boolean,
  ): Promise<GenerationReply<GeneratedProject>>;
  cancel(): Promise<GenerationReply<void>>;
  retrySave(asNewProject?: boolean): Promise<GenerationReply<GeneratedProject>>;
  discardPending(): Promise<GenerationReply<void>>;
  image(id: string, imageId: string): Promise<GenerationReply<Uint8Array>>;
}

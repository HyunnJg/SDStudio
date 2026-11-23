import type { NaiErrorCode } from './naiAuth';
import type { ProjectErrorCode, ProjectSnapshot } from './workspaceProject';

export type GenerationCode =
  | NaiErrorCode
  | ProjectErrorCode
  | 'GENERATION_BUSY'
  | 'CONFIRMATION_EXPIRED'
  | 'UNSUPPORTED_DRAFT'
  | 'RESULT_SAVE_FAILED'
  | 'QUEUE_LIMIT';
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
export interface GenerationQueueItem {
  id: string;
  sceneId: string;
  sceneName: string;
  repeat: number;
  seed: number;
  status:
    'pending' | 'preparing' | 'running' | 'done' | 'failed' | 'result-pending';
  imageId?: string;
  error?: GenerationFailure;
}
export interface GenerationQueuePlan {
  ticket: string;
  queueId: string;
  total: number;
  items: GenerationQueueItem[];
  model: 'nai-diffusion-4-5-full';
  width: 512;
  height: 512;
  steps: 28;
  scale: 5;
}
export interface GenerationQueueState {
  id: string;
  projectId: string;
  running: boolean;
  stopped: boolean;
  items: GenerationQueueItem[];
}
export interface GenerationQueueStatus {
  queue?: GenerationQueueState;
  latest?: GeneratedProject;
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
  prepareQueue(
    id: string,
    revision: string,
    sceneIds: string[],
    repeats: number,
  ): Promise<GenerationReply<GenerationQueuePlan>>;
  prepareRemaining(
    queueId: string,
    id: string,
    revision: string,
  ): Promise<GenerationReply<GenerationQueuePlan>>;
  runQueue(
    ticket: string,
    webCostConfirmed: boolean,
  ): Promise<GenerationReply<GenerationQueueStatus>>;
  clearQueue(): Promise<GenerationReply<void>>;
  queueStatus(
    knownRevision?: string,
  ): Promise<GenerationReply<GenerationQueueStatus>>;
  cancel(): Promise<GenerationReply<void>>;
  retrySave(asNewProject?: boolean): Promise<GenerationReply<GeneratedProject>>;
  discardPending(): Promise<GenerationReply<void>>;
  image(id: string, imageId: string): Promise<GenerationReply<Uint8Array>>;
}

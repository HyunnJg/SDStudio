import type {
  ImagePurpose,
  ReferenceAsset,
  WorkspaceReference,
} from './workspaceReference';
import type { NaiErrorCode } from './naiAuth';
import type { ProjectErrorCode, ProjectSnapshot } from './workspaceProject';

export const DEFAULT_QUEUE_INTERVAL = 10;
export const isQueueInterval = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= 3600;

export type GenerationCode =
  | NaiErrorCode
  | ProjectErrorCode
  | 'GENERATION_BUSY'
  | 'CONFIRMATION_EXPIRED'
  | 'UNSUPPORTED_DRAFT'
  | 'RESULT_SAVE_FAILED'
  | 'QUEUE_LIMIT'
  | 'GENERATION_BODY_LIMIT'
  | 'QUEUE_INPUT_CHANGED';
export interface GenerationFailure {
  ok: false;
  code: GenerationCode;
  mayHaveReachedServer: boolean;
  httpStatus?: number;
  projectCode?: ProjectErrorCode;
  pendingResult?: true;
  conflictSceneId?: string;
}
export type GenerationReply<T> = { ok: true; value: T } | GenerationFailure;
export interface GenerationSettings {
  model: import('./workspaceCatalog').ModelId;
  width: number;
  height: number;
  steps: number;
  scale: number;
  characters?: number;
  img2img?: { strength: number; noise: number };
  reference?: Pick<
    WorkspaceReference,
    'id' | 'uploadHash' | 'role' | 'strength' | 'preferSameOutfit'
  >;
}
export interface GenerationPlan extends GenerationSettings {
  ticket: string;
  seed: number;
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
    | 'pending'
    | 'preparing'
    | 'running'
    | 'done'
    | 'failed'
    | 'result-pending'
    | 'skipped';
  imageId?: string;
  error?: GenerationFailure;
  settings?: GenerationSettings;
}
export interface GenerationQueuePlan {
  ticket: string;
  queueId: string;
  total: number;
  intervalSeconds: number;
  items: GenerationQueueItem[];
  model: GenerationSettings['model'];
  width: number;
  height: number;
  steps: number;
  scale: number;
  settings: GenerationSettings[];
}
export interface GenerationQueueState {
  id: string;
  projectId: string;
  running: boolean;
  stopped: boolean;
  stoppedItemId?: string;
  intervalSeconds: number;
  nextRequestAt?: number;
  items: GenerationQueueItem[];
}
export interface GenerationQueueStatus {
  queue?: GenerationQueueState;
  latest?: GeneratedProject;
}

export interface GenerationClient {
  importReference(
    id: string,
    revision: string,
    png: Uint8Array,
    purpose?: ImagePurpose,
  ): Promise<GenerationReply<{ asset: ReferenceAsset; preview: Uint8Array }>>;
  referenceImage(
    id: string,
    sceneId: string,
    purpose?: ImagePurpose,
  ): Promise<GenerationReply<Uint8Array>>;
  status(): Promise<GenerationReply<{ active: boolean; pending: boolean }>>;
  prepare(
    id: string,
    revision: string,
    sceneId: string,
  ): Promise<GenerationReply<GenerationPlan>>;
  run(
    ticket: string,
    executionConfirmed: boolean,
  ): Promise<GenerationReply<GeneratedProject>>;
  prepareQueue(
    id: string,
    revision: string,
    sceneIds: string[],
    repeats: number,
    intervalSeconds?: number,
  ): Promise<GenerationReply<GenerationQueuePlan>>;
  prepareRemaining(
    queueId: string,
    id: string,
    revision: string,
    intervalSeconds?: number,
  ): Promise<GenerationReply<GenerationQueuePlan>>;
  runQueue(
    ticket: string,
    executionConfirmed: boolean,
  ): Promise<GenerationReply<GenerationQueueStatus>>;
  excludePendingScene(
    queueId: string,
    sceneId: string,
    confirmed: boolean,
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

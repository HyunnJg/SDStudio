/* eslint no-restricted-syntax: off -- Bounded ordered schema validation exits on the first invalid record. */
// Independent of V3 Session.version. Only allowlisted workspace content is persisted.
import type {
  WorkspaceDraft,
  WorkspaceScene,
} from './renderer/preview/workspaceDraft';

export const PROJECT_FORMAT = 'sdstudio-workspace';
export const PROJECT_LIMITS = {
  jsonBytes: 2 * 1024 * 1024,
  scenes: 60,
  characters: 32,
  results: 120,
  totalPNGBytes: 256 * 1024 * 1024,
} as const;
export type ProjectErrorCode =
  | 'PROJECT_INPUT'
  | 'PROJECT_VERSION'
  | 'PROJECT_CORRUPT'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_CONFLICT'
  | 'PROJECT_BUSY'
  | 'PROJECT_SERVICE_STOPPED'
  | 'PROJECT_IO'
  | 'PROJECT_LIMIT'
  | 'PROJECT_UNTRUSTED';
export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode) {
    super(code);
    this.name = 'ProjectError';
  }
}
export interface ProjectContent {
  name: string;
  selectedSceneId: string;
  scenes: WorkspaceScene[];
}
export interface ImageBinding {
  id: 'nai-v45-basic512-v1' | 'nai-v5-full-v1' | 'nai-v5-characters-auto-v1';
  requestHash: string;
}
export interface ProjectImage {
  binding?: ImageBinding;
  id: string;
  sceneId: string;
  model: string;
  sampler: string;
  noiseSchedule: string;
  seed: number;
  draft: WorkspaceDraft;
  sha256: string;
  pngBytes: number;
}
export type ProjectImageInput = Omit<
  ProjectImage,
  'id' | 'sha256' | 'pngBytes'
>;
export interface WorkspaceProject extends ProjectContent {
  format: typeof PROJECT_FORMAT;
  version: 1 | 2 | 3 | 4;
  id: string;
  images: ProjectImage[];
}
export interface ProjectSnapshot {
  project: WorkspaceProject;
  revision: string;
}
export interface ProjectListing {
  id: string;
  name?: string;
  revision?: string;
  error?: ProjectErrorCode;
}
export type ProjectReply<T> =
  { ok: true; value: T } | { ok: false; code: ProjectErrorCode };
export interface ProjectClient {
  restartStorage(): Promise<ProjectReply<void>>;
  list(): Promise<ProjectReply<ProjectListing[]>>;
  create(content: ProjectContent): Promise<ProjectReply<ProjectSnapshot>>;
  open(id: string): Promise<ProjectReply<ProjectSnapshot>>;
  save(
    id: string,
    revision: string,
    content: ProjectContent,
  ): Promise<ProjectReply<ProjectSnapshot>>;
  history(id: string): Promise<ProjectReply<string[]>>;
  recover(id: string, revision: string): Promise<ProjectReply<ProjectSnapshot>>;
  copy(
    id: string,
    revision: string,
    content: ProjectContent,
  ): Promise<ProjectReply<ProjectSnapshot>>;
}
export function projectCheck(
  value: unknown,
  code: ProjectErrorCode = 'PROJECT_INPUT',
): asserts value {
  if (!value) throw new ProjectError(code);
}
export function projectId(value: unknown): asserts value is string {
  projectCheck(
    typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value,
      ),
  );
}
export function projectHash(value: unknown): asserts value is string {
  projectCheck(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  projectCheck(value && typeof value === 'object' && !Array.isArray(value));
  const object = value as Record<string, unknown>;
  projectCheck(
    Object.keys(object).length === keys.length &&
      keys.every((key) => Object.hasOwn(object, key)),
  );
  return object;
}
function string(value: unknown, maximum = 65536): asserts value is string {
  projectCheck(
    typeof value === 'string' &&
      value.length <= maximum &&
      !value.includes('\0'),
  );
}
function choice(value: unknown, choices: unknown[]) {
  projectCheck(choices.includes(value));
}
function localId(value: unknown): asserts value is string {
  projectCheck(
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value),
  );
}
function draft(value: unknown): number {
  const optional = ['qualityTags', 'ucPreset'].filter(
    (key) => !!value && typeof value === 'object' && Object.hasOwn(value, key),
  );
  const d = record(value, [
    ...optional,
    'family',
    'prompt',
    'negativePrompt',
    'characters',
    'placement',
    'resolution',
    'seedMode',
    'seed',
    'steps',
    'guidance',
  ]);
  choice(d.family, ['v4.5', 'v5']);
  if (optional.includes('qualityTags'))
    choice(d.qualityTags, ['none', 'light', 'standard']);
  if (optional.includes('ucPreset'))
    choice(d.ucPreset, ['none', 'light', 'heavy', 'human', 'furry']);
  choice(d.placement, ['auto', 'manual']);
  choice(d.resolution, ['portrait', 'landscape', 'square']);
  choice(d.seedMode, ['random', 'fixed']);
  string(d.prompt);
  string(d.negativePrompt);
  // Keep unfinished editor text, disabled characters and logical grid cells without API projection.
  for (const key of ['seed', 'steps', 'guidance']) string(d[key], 64);
  projectCheck(
    Array.isArray(d.characters) &&
      d.characters.length <= PROJECT_LIMITS.characters,
  );
  let textLength = d.prompt.length + d.negativePrompt.length;
  const ids = new Set<string>();
  for (const valueCharacter of d.characters) {
    const c = record(valueCharacter, [
      'id',
      'enabled',
      'prompt',
      'negativePrompt',
      'cell',
    ]);
    localId(c.id);
    projectCheck(!ids.has(c.id));
    ids.add(c.id);
    projectCheck(typeof c.enabled === 'boolean');
    string(c.prompt);
    string(c.negativePrompt);
    textLength += c.prompt.length + c.negativePrompt.length;
    projectCheck(textLength <= PROJECT_LIMITS.jsonBytes, 'PROJECT_LIMIT');
    const cell = record(c.cell, ['row', 'column']);
    for (const v of Object.values(cell))
      projectCheck(Number.isInteger(v) && Number(v) >= 0 && Number(v) < 5);
  }
  return textLength;
}
export function validateProjectContent(value: unknown): ProjectContent {
  const p = record(value, ['name', 'selectedSceneId', 'scenes']);
  string(p.name, 120);
  projectCheck(p.name.trim().length > 0);
  localId(p.selectedSceneId);
  projectCheck(
    Array.isArray(p.scenes) &&
      p.scenes.length > 0 &&
      p.scenes.length <= PROJECT_LIMITS.scenes,
  );
  let textLength = 0;
  const ids = new Set<string>();
  for (const valueScene of p.scenes) {
    const s = record(valueScene, ['id', 'name', 'draft']);
    localId(s.id);
    projectCheck(!ids.has(s.id));
    ids.add(s.id);
    string(s.name, 120);
    textLength += draft(s.draft);
    projectCheck(textLength <= PROJECT_LIMITS.jsonBytes, 'PROJECT_LIMIT');
  }
  projectCheck(ids.has(p.selectedSceneId));
  return structuredClone(value as ProjectContent);
}
export function validateImageInput(value: unknown): ProjectImageInput {
  const hasBinding =
    !!value && typeof value === 'object' && Object.hasOwn(value, 'binding');
  const r = record(value, [
    ...(hasBinding ? ['binding'] : []),
    'sceneId',
    'model',
    'sampler',
    'noiseSchedule',
    'seed',
    'draft',
  ]);
  localId(r.sceneId);
  for (const key of ['model', 'sampler', 'noiseSchedule'])
    projectCheck(
      typeof r[key] === 'string' &&
        /^[A-Za-z0-9_.-]{1,128}$/.test(r[key] as string),
    );
  projectCheck(
    Number.isInteger(r.seed) &&
      Number(r.seed) >= 0 &&
      Number(r.seed) <= 4294967295,
  );
  if (hasBinding) {
    const binding = record(r.binding, ['id', 'requestHash']);
    projectCheck(
      [
        'nai-v45-basic512-v1',
        'nai-v5-full-v1',
        'nai-v5-characters-auto-v1',
      ].includes(String(binding.id)),
    );
    projectHash(binding.requestHash);
  }
  draft(r.draft);
  return structuredClone(value as ProjectImageInput);
}
export function requiredProjectVersion(
  content: ProjectContent,
  images: readonly ProjectImageInput[] = [],
): 1 | 2 | 3 | 4 {
  if (images.some((i) => i.binding?.id === 'nai-v5-characters-auto-v1'))
    return 4;
  const drafts = [
    ...content.scenes.map((s) => s.draft),
    ...images.map((i) => i.draft),
  ];
  if (
    drafts.some(
      (d) => Object.hasOwn(d, 'qualityTags') || Object.hasOwn(d, 'ucPreset'),
    ) ||
    images.some((i) => i.binding?.id === 'nai-v5-full-v1')
  )
    return 3;
  return images.some((i) => i.binding) ? 2 : 1;
}
export function validateWorkspaceProject(value: unknown): WorkspaceProject {
  projectCheck(value && typeof value === 'object', 'PROJECT_CORRUPT');
  const v = value as Record<string, unknown>;
  projectCheck(v.format === PROJECT_FORMAT, 'PROJECT_CORRUPT');
  projectCheck(
    Number.isInteger(v.version) && Number(v.version) > 0,
    'PROJECT_CORRUPT',
  );
  projectCheck(
    v.version === 1 || v.version === 2 || v.version === 3 || v.version === 4,
    'PROJECT_VERSION',
  );
  try {
    const p = record(value, [
      'format',
      'version',
      'id',
      'name',
      'selectedSceneId',
      'scenes',
      'images',
    ]);
    projectId(p.id);
    validateProjectContent({
      name: p.name,
      selectedSceneId: p.selectedSceneId,
      scenes: p.scenes,
    });
    projectCheck(Array.isArray(p.images));
    projectCheck(p.images.length <= PROJECT_LIMITS.results, 'PROJECT_LIMIT');
    const ids = new Set<string>();
    let total = 0;
    for (const image of p.images) {
      const hasBinding =
        !!image && typeof image === 'object' && Object.hasOwn(image, 'binding');
      projectCheck(!hasBinding || Number(p.version) >= 2);
      const i = record(image, [
        ...(hasBinding ? ['binding'] : []),
        'id',
        'sceneId',
        'model',
        'sampler',
        'noiseSchedule',
        'seed',
        'draft',
        'sha256',
        'pngBytes',
      ]);
      projectId(i.id);
      projectHash(i.sha256);
      projectCheck(!ids.has(i.id));
      ids.add(i.id);
      const { pngBytes } = i;
      const input = {
        ...(hasBinding ? { binding: i.binding } : {}),
        sceneId: i.sceneId,
        model: i.model,
        sampler: i.sampler,
        noiseSchedule: i.noiseSchedule,
        seed: i.seed,
        draft: i.draft,
      };
      validateImageInput(input);
      projectCheck(
        Number.isInteger(pngBytes) &&
          Number(pngBytes) > 0 &&
          Number(pngBytes) <= 32 * 1024 * 1024,
      );
      total += Number(pngBytes);
    }
    projectCheck(total <= PROJECT_LIMITS.totalPNGBytes, 'PROJECT_LIMIT');
    projectCheck(
      Number(p.version) >=
        requiredProjectVersion(
          value as WorkspaceProject,
          (value as WorkspaceProject).images,
        ),
    );
    return structuredClone(value as WorkspaceProject);
  } catch (error) {
    throw new ProjectError(
      error instanceof ProjectError && error.code === 'PROJECT_LIMIT'
        ? 'PROJECT_LIMIT'
        : 'PROJECT_CORRUPT',
    );
  }
}

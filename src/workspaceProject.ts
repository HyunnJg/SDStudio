import { V5_SIZES } from './workspaceGenerationSettings';
import { validPieces } from './workspacePromptPieces';
import { MODELS, resolveSize, allowedSize } from './workspaceCatalog';
/* eslint no-restricted-syntax: off -- Bounded ordered schema validation exits on the first invalid record. */
// Independent of V3 Session.version. Only allowlisted workspace content is persisted.
import type {
  WorkspaceDraft,
  WorkspaceScene,
} from './renderer/preview/workspaceDraft';

import type {
  ReferenceAsset,
  WorkspaceReference,
  WorkspaceVariation,
} from './workspaceReference';
import { REFERENCE_LIMITS } from './workspaceReference';

export const PROJECT_FORMAT = 'sdstudio-workspace';
export const PROJECT_LIMITS = {
  jsonBytes: 2 * 1024 * 1024,
  scenes: 60,
  characters: 32,
  results: 120,
  totalPNGBytes: 256 * 1024 * 1024,
} as const;
export type ProjectCapacityCode =
  'PROJECT_RESULT_LIMIT' | 'PROJECT_GENERATION_SPACE' | 'PROJECT_HISTORY_LIMIT';

export function isProjectCapacityCode(
  code: unknown,
): code is ProjectCapacityCode {
  return (
    code === 'PROJECT_RESULT_LIMIT' ||
    code === 'PROJECT_GENERATION_SPACE' ||
    code === 'PROJECT_HISTORY_LIMIT'
  );
}

export type ProjectErrorCode =
  | ProjectCapacityCode
  | 'PROJECT_INPUT'
  | 'PROJECT_VERSION'
  | 'PROJECT_CORRUPT'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_CONFLICT'
  | 'PROJECT_BUSY'
  | 'PROJECT_SERVICE_STOPPED'
  | 'PROJECT_IO'
  | 'PROJECT_LIMIT'
  | 'PROJECT_IMAGE_TOO_LARGE'
  | 'PROJECT_LEGACY_SCENE'
  | 'PROJECT_LEGACY_PIECE'
  | 'PROJECT_LEGACY_PICK'
  | 'PROJECT_LEGACY_MASK'
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
  id:
    | 'nai-v45-basic512-v1'
    | 'nai-catalog-v1'
    | 'nai-v5-full-v1'
    | 'nai-v5-characters-auto-v1'
    | 'nai-v5-reference-v1'
    | 'nai-v3-inpaint-v1'
    | 'nai-v5-img2img-v1'
    | 'nai-v5-img2img-reference-v1';
  requestHash: string;
}
interface ImageFile {
  id: string;
  sceneId: string;
  sha256: string;
  pngBytes: number;
}
export interface GeneratedImage extends ImageFile {
  origin?: undefined;
  binding?: ImageBinding;
  model: string;
  sampler: string;
  noiseSchedule: string;
  seed: number;
  draft: WorkspaceDraft;
}
export interface ImportedImage extends ImageFile {
  origin: 'v3-pick';
  sourceScene: string;
  filename: string;
}
export type ProjectImage = GeneratedImage | ImportedImage;
export type ProjectImageInput = Omit<
  GeneratedImage,
  'id' | 'sha256' | 'pngBytes'
>;
export interface WorkspaceProject extends ProjectContent {
  format: typeof PROJECT_FORMAT;
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  id: string;
  images: ProjectImage[];
  trashedImageIds?: string[];
}
export interface ProjectSnapshot {
  project: WorkspaceProject;
  revision: string;
}
export interface ResultTrashReport {
  removedResults: number;
  deletedFiles: number;
  deletedBytes: number;
  cleanupIncomplete: boolean;
}
export interface ProjectListing {
  deleting?: true;
  id: string;
  name?: string;
  revision?: string;
  error?: ProjectErrorCode;
}
export type ProjectReply<T> =
  { ok: true; value: T } | { ok: false; code: ProjectErrorCode };
export interface ProjectClient {
  copyLegacyScene(
    name: string,
    key: string,
    withPicks: boolean,
  ): Promise<ProjectReply<ProjectSnapshot>>;
  copyLegacyMasks(
    name: string,
    selected?: string[],
  ): Promise<ProjectReply<ProjectSnapshot | { failedScene: string }>>;
  resultPicks(id: string): Promise<ProjectReply<string[]>>;
  setResultPicks(
    id: string,
    revision: string,
    ids: string[],
    picked: boolean,
  ): Promise<ProjectReply<string[]>>;
  exportResults(id: string, imageIds: string[]): Promise<ProjectReply<boolean>>;
  restartStorage(): Promise<ProjectReply<void>>;
  list(): Promise<ProjectReply<ProjectListing[]>>;
  listTrash(): Promise<ProjectReply<ProjectListing[]>>;
  trashProject(id: string): Promise<ProjectReply<void>>;
  purgeProject(id: string, confirmed: boolean): Promise<ProjectReply<void>>;
  restoreProject(id: string): Promise<ProjectReply<void>>;
  emptyResultTrash(
    id: string,
    revision: string,
    confirmed: boolean,
  ): Promise<
    ProjectReply<{ snapshot: ProjectSnapshot; report: ResultTrashReport }>
  >;
  setImageDeleted(
    id: string,
    revision: string,
    imageId: string,
    deleted: boolean,
  ): Promise<ProjectReply<ProjectSnapshot>>;
  create(
    content: ProjectContent,
    referenceSourceId?: string,
  ): Promise<ProjectReply<ProjectSnapshot>>;
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

function imageAsset(value: unknown, fields: string[]) {
  const r = record(value, [
    'id',
    ...(value &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'sourceFormat')
      ? ['sourceFormat']
      : []),
    'sourceHash',
    'sourceBytes',
    'uploadHash',
    'uploadBytes',
    'width',
    'height',
    ...fields,
  ]);
  if (Object.hasOwn(r, 'sourceFormat'))
    choice(r.sourceFormat, ['webp', 'jpeg']);
  projectId(r.id);
  projectHash(r.sourceHash);
  projectHash(r.uploadHash);
  for (const [key, max] of [
    ['sourceBytes', REFERENCE_LIMITS.sourceBytes],
    ['uploadBytes', REFERENCE_LIMITS.uploadBytes],
  ] as const)
    projectCheck(
      Number.isInteger(r[key]) && Number(r[key]) > 0 && Number(r[key]) <= max,
    );
  projectCheck(
    !fields.includes('role')
      ? allowedSize(Number(r.width), Number(r.height)) &&
          typeof r.width === 'number' &&
          typeof r.height === 'number'
      : [
          [832, 1216],
          [1024, 1024],
          [1216, 832],
        ].some(([w, h]) => r.width === w && r.height === h),
  );
  return r;
}
export function validateReferenceAsset(value: unknown): ReferenceAsset {
  imageAsset(value, []);
  return structuredClone(value as ReferenceAsset);
}
export function validateVariation(value: unknown): WorkspaceVariation {
  const r = imageAsset(value, ['strength', 'noise']);
  for (const n of [r.strength, r.noise])
    projectCheck(
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
    );
  return structuredClone(value as WorkspaceVariation);
}
export function validateReference(value: unknown): WorkspaceReference {
  const r = imageAsset(value, ['role', 'strength', 'preferSameOutfit']);
  choice(r.role, ['character', 'style', 'character-style', 'outfit']);
  projectCheck(
    typeof r.strength === 'number' &&
      Number.isFinite(r.strength) &&
      r.strength >= 0 &&
      r.strength <= 5,
  );
  projectCheck(typeof r.preferSameOutfit === 'boolean');
  projectCheck(
    !r.preferSameOutfit ||
      r.role === 'character' ||
      r.role === 'character-style',
  );
  return structuredClone(value as WorkspaceReference);
}
export function projectReferences(
  content: ProjectContent,
  images: readonly (ProjectImageInput | ImportedImage)[] = [],
): ReferenceAsset[] {
  return [
    ...content.scenes.map((s) => s.draft),
    ...images.flatMap((i) => (i.origin ? [] : [i.draft])),
  ]
    .flatMap((d) => [d.reference, d.img2img, d.inpaintSource, d.inpaintMask])
    .filter((asset) => asset !== undefined);
}
export function referenceAssetBytes(project: WorkspaceProject): number {
  const sizes = new Map<string, number>();
  for (const r of projectReferences(project, project.images)) {
    for (const [hash, size] of [
      [r.sourceHash, r.sourceBytes],
      [r.uploadHash, r.uploadBytes],
    ] as const) {
      projectCheck(
        !sizes.has(hash) || sizes.get(hash) === size,
        'PROJECT_CORRUPT',
      );
      sizes.set(hash, size);
    }
  }
  return [...sizes.values()].reduce((n, size) => n + size, 0);
}

export function remainingProjectBytes(project: WorkspaceProject): number {
  return (
    PROJECT_LIMITS.totalPNGBytes -
    referenceAssetBytes(project) -
    project.images.reduce((total, image) => total + image.pngBytes, 0)
  );
}

function draft(value: unknown): number {
  const optional = [
    'pieces',
    'model',
    'qualityTags',
    'ucPreset',
    'reference',
    'img2img',
    'inpaintSource',
    'inpaintMask',
  ].filter(
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

  if (optional.includes('inpaintSource'))
    validateReferenceAsset(d.inpaintSource);
  if (optional.includes('inpaintMask')) {
    const mask = validateReferenceAsset(d.inpaintMask);
    const source = d.inpaintSource as ReferenceAsset | undefined;
    projectCheck(
      source &&
        source.width === mask.width &&
        source.height === mask.height &&
        !mask.sourceFormat,
    );
  }
  if (optional.includes('img2img')) validateVariation(d.img2img);
  if (optional.includes('reference')) validateReference(d.reference);
  if (optional.includes('qualityTags'))
    choice(d.qualityTags, ['none', 'light', 'standard']);
  if (optional.includes('ucPreset'))
    choice(d.ucPreset, ['none', 'light', 'heavy', 'human', 'furry']);
  if (optional.includes('pieces')) projectCheck(validPieces(d.pieces));
  choice(d.placement, ['auto', 'manual']);
  projectCheck(typeof d.resolution === 'string');
  try {
    resolveSize(d.resolution);
  } catch {
    projectCheck(false);
  }
  if (optional.includes('model'))
    projectCheck(
      typeof d.model === 'string' &&
        Object.hasOwn(MODELS, d.model) &&
        (d.family === 'v5') === d.model.startsWith('nai-diffusion-5-'),
    );
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
  draft(r.draft);
  const sourceDraft = r.draft as WorkspaceDraft;
  if (sourceDraft.inpaintSource || sourceDraft.inpaintMask)
    projectCheck(
      hasBinding &&
        sourceDraft.inpaintSource &&
        sourceDraft.inpaintMask &&
        sourceDraft.model === 'nai-diffusion-3' &&
        r.model === 'nai-diffusion-3-inpainting' &&
        !sourceDraft.reference &&
        !sourceDraft.img2img,
    );
  if (sourceDraft.img2img)
    projectCheck(hasBinding && sourceDraft.family === 'v5');
  if (hasBinding) {
    const binding = record(r.binding, ['id', 'requestHash']);
    projectCheck(
      [
        'nai-v3-inpaint-v1',
        'nai-v45-basic512-v1',
        'nai-catalog-v1',
        'nai-v5-full-v1',
        'nai-v5-characters-auto-v1',
        'nai-v5-reference-v1',
        'nai-v5-img2img-v1',
        'nai-v5-img2img-reference-v1',
      ].includes(String(binding.id)),
    );
    projectCheck(
      (binding.id === 'nai-v3-inpaint-v1') === !!sourceDraft.inpaintMask &&
        (binding.id === 'nai-v5-img2img-reference-v1') ===
          !!(sourceDraft.reference && sourceDraft.img2img) &&
        (binding.id === 'nai-v5-img2img-v1') ===
          !!(sourceDraft.img2img && !sourceDraft.reference),
    );
    projectHash(binding.requestHash);
  }
  return structuredClone(value as ProjectImageInput);
}
export function requiredProjectVersion(
  content: ProjectContent,
  records: readonly (ProjectImageInput | ImportedImage)[] = [],
): WorkspaceProject['version'] {
  if (records.some((i) => i.origin)) return 12;
  const images = records.filter((i): i is ProjectImageInput => !i.origin);
  if (
    [...content.scenes, ...images].some(
      ({ draft: d }) => d.inpaintSource || d.inpaintMask,
    )
  )
    return 11;
  const extended = ({ draft: d }: { draft: WorkspaceDraft }) =>
    !!d.pieces ||
    !!d.model ||
    (!!d.img2img &&
      !Object.values(V5_SIZES).some(
        (s) => s.width === d.img2img!.width && s.height === d.img2img!.height,
      )) ||
    !['portrait', 'landscape', 'square'].includes(d.resolution);
  if (content.scenes.some(extended) || images.some(extended)) return 10;
  if (
    content.scenes.some(
      (entry) => entry.draft.reference && entry.draft.img2img,
    ) ||
    images.some((entry) => entry.draft.reference && entry.draft.img2img)
  )
    return 9;
  if (
    projectReferences(content, images).some(
      (r) => r.sourceFormat || r.uploadBytes > 2 * 1024 * 1024,
    )
  )
    return 8;
  if (
    content.scenes.some((s) => s.draft.img2img) ||
    images.some((i) => i.draft.img2img || i.binding?.id === 'nai-v5-img2img-v1')
  )
    return 7;
  if (
    content.scenes.some((s) => s.draft.reference) ||
    images.some(
      (i) => i.draft.reference || i.binding?.id === 'nai-v5-reference-v1',
    )
  )
    return 5;
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
    v.version === 1 ||
      v.version === 2 ||
      v.version === 3 ||
      v.version === 4 ||
      v.version === 5 ||
      v.version === 6 ||
      v.version === 7 ||
      v.version === 8 ||
      v.version === 9 ||
      v.version === 10 ||
      v.version === 11 ||
      v.version === 12,
    'PROJECT_VERSION',
  );
  try {
    const hasTrash =
      v.version === 6 ||
      (Number(v.version) >= 7 && Object.hasOwn(v, 'trashedImageIds'));
    const p = record(value, [
      'format',
      'version',
      'id',
      'name',
      'selectedSceneId',
      'scenes',
      'images',
      ...(hasTrash ? ['trashedImageIds'] : []),
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
      projectCheck(image && typeof image === 'object');
      const { id, sha256, pngBytes, ...input } = image;
      projectId(id);
      projectHash(sha256);
      projectCheck(!ids.has(id));
      ids.add(id);
      if (Object.hasOwn(input, 'origin')) {
        const imported = record(input, [
          'origin',
          'sourceScene',
          'filename',
          'sceneId',
        ]);
        projectCheck(v.version === 12 && imported.origin === 'v3-pick');
        projectCheck(imported.sceneId === 'v3-source');
        string(imported.sourceScene, 180);
        string(imported.filename, 180);
        projectCheck(
          typeof imported.filename === 'string' &&
            /^[^\\/:*?"<>|]+\.png$/i.test(imported.filename),
        );
      } else {
        projectCheck(
          !Object.hasOwn(input, 'binding') || Number(p.version) >= 2,
        );
        validateImageInput(input);
      }
      projectCheck(
        Number.isInteger(pngBytes) &&
          Number(pngBytes) > 0 &&
          Number(pngBytes) <= 32 * 1024 * 1024,
      );
      total += Number(pngBytes);
    }
    if (hasTrash) {
      projectCheck(Array.isArray(p.trashedImageIds));
      projectCheck(
        p.trashedImageIds.length <= PROJECT_LIMITS.results,
        'PROJECT_LIMIT',
      );
      const deleted = new Set<string>();
      for (const id of p.trashedImageIds) {
        projectId(id);
        projectCheck(ids.has(id) && !deleted.has(id));
        deleted.add(id);
      }
    }
    total += referenceAssetBytes(value as WorkspaceProject);
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

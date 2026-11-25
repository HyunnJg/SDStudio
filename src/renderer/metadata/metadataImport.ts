import type { WorkspaceDraft } from '../preview/workspaceDraft';
import type { PNGMetadata } from './pngMetadata';
import {
  V5_SIZES,
  V5_CHARACTER_LIMIT,
} from '../../workspaceGenerationSettings';

export type ImportField =
  'prompt' | 'negativePrompt' | 'characters' | 'settings' | 'seed';
export interface ImportCharacter {
  prompt: string;
  negativePrompt: string;
}
export interface MetadataImportPlan {
  prompt?: string;
  negativePrompt?: string;
  characters?: ImportCharacter[];
  seed?: string;
  settings: Partial<Pick<WorkspaceDraft, 'resolution' | 'steps' | 'guidance'>>;
  notices: string[];
  source: PNGMetadata['source'];
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length <= 65536 && !v.includes('\0')
    ? v
    : undefined;
const number = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
export function planMetadataImport(
  metadata: PNGMetadata,
  draft: WorkspaceDraft,
): MetadataImportPlan {
  const c = metadata.comment;
  const positive = record(c.v4_prompt);
  const negative = record(c.v4_negative_prompt);
  const pc = record(positive.caption);
  const nc = record(negative.caption);
  const notices: string[] = [];
  const plan: MetadataImportPlan = {
    settings: {},
    notices,
    source: metadata.source,
  };
  plan.prompt =
    text(pc.base_caption) ?? text(c.prompt) ?? text(metadata.description);
  plan.negativePrompt =
    text(nc.base_caption) ?? text(c.uc) ?? text(c.negative_prompt);
  const seed = number(c.seed);
  if (
    seed !== undefined &&
    Number.isInteger(seed) &&
    seed >= 0 &&
    seed <= 4294967295
  )
    plan.seed = String(seed);
  const chars: unknown = pc.char_captions;
  const negatives: unknown = nc.char_captions;
  if (Array.isArray(chars)) {
    const neg = Array.isArray(negatives) ? negatives : [];
    if (
      chars.length <= V5_CHARACTER_LIMIT &&
      (neg.length === 0 || neg.length === chars.length) &&
      chars.every(
        (p, i) =>
          text(record(p).char_caption) !== undefined &&
          (neg.length === 0 || text(record(neg[i]).char_caption) !== undefined),
      )
    ) {
      if (draft.family !== 'v5' && chars.length > 0)
        notices.push(
          '가져온 캐릭터는 입력으로 보관합니다. 생성하려면 이 앱의 V5 Full 경로를 선택하세요.',
        );
      plan.characters = chars.map((p, i) => ({
        prompt: text(record(p).char_caption)!,
        negativePrompt: neg.length ? text(record(neg[i]).char_caption)! : '',
      }));
      if (positive.use_coords === true)
        notices.push(
          '캐릭터 좌표는 가져오지 않고 파일에 적힌 순서의 텍스트를 자동 배치로 적용합니다.',
        );
    } else
      notices.push(
        '캐릭터 수·입력 또는 긍정/부정 대응을 확인할 수 없어 캐릭터는 가져오지 않습니다.',
      );
  }
  const width = number(c.width) ?? metadata.width;
  const height = number(c.height) ?? metadata.height;
  if (draft.family === 'v5') {
    const size = (Object.keys(V5_SIZES) as WorkspaceDraft['resolution'][]).find(
      (key) => V5_SIZES[key].width === width && V5_SIZES[key].height === height,
    );
    if (size) plan.settings.resolution = size;
    else
      notices.push(
        '원본 크기는 이 앱에서 지원하지 않아 현재 크기를 유지합니다.',
      );
    const steps = number(c.steps);
    const scale = number(c.scale);
    if (
      steps !== undefined &&
      Number.isInteger(steps) &&
      steps >= 1 &&
      steps <= 50
    )
      plan.settings.steps = String(steps);
    else if (c.steps !== undefined)
      notices.push('원본 스텝을 적용할 수 없어 현재 값을 유지합니다.');
    if (scale !== undefined && scale > 0 && scale <= 10)
      plan.settings.guidance = String(scale);
    else if (c.scale !== undefined)
      notices.push('원본 가이던스를 적용할 수 없어 현재 값을 유지합니다.');
  } else if (
    width === 512 &&
    height === 512 &&
    c.steps === 28 &&
    c.scale === 5
  ) {
    plan.settings = { resolution: 'square', steps: '28', guidance: '5' };
  } else
    notices.push(
      '현재 V4.5 경로의 고정 512px 설정과 달라 생성 설정은 유지합니다.',
    );
  if (
    (c.cfg_rescale !== undefined && c.cfg_rescale !== 0) ||
    (c.sampler !== undefined && c.sampler !== 'k_euler_ancestral') ||
    (c.noise_schedule !== undefined && c.noise_schedule !== 'karras') ||
    c.sm === true ||
    c.sm_dyn === true
  )
    notices.push(
      '원본 샘플러·노이즈 스케줄·CFG rescale 등의 고급 설정 일부는 적용하지 않습니다. 현재 앱의 Euler ancestral/Karras·rescale 0을 유지합니다.',
    );
  if (
    c.strength !== undefined ||
    c.image !== undefined ||
    c.reference_image_multiple !== undefined ||
    c.reference_image !== undefined ||
    c.director_reference_images !== undefined
  )
    notices.push(
      'Image2Image·참조 이미지·Vibe 정보는 가져오지 않습니다. 메타데이터만으로 원본 결과를 재현할 수 없습니다.',
    );
  const originalModel = c.model;
  if (
    originalModel !== undefined &&
    originalModel !==
      (draft.family === 'v5'
        ? 'nai-diffusion-5-full'
        : 'nai-diffusion-4-5-full')
  )
    notices.push(
      '원본 모델과 현재 선택 모델이 다릅니다. 현재 모델을 유지합니다.',
    );
  return plan;
}
export function availableImportFields(plan: MetadataImportPlan): ImportField[] {
  const fields: ImportField[] = [];
  if (plan.prompt !== undefined) fields.push('prompt');
  if (plan.negativePrompt !== undefined) fields.push('negativePrompt');
  if (plan.characters !== undefined) fields.push('characters');
  if (Object.keys(plan.settings).length) fields.push('settings');
  if (plan.seed !== undefined) fields.push('seed');
  return fields;
}
export function applyMetadataImport(
  draft: WorkspaceDraft,
  plan: MetadataImportPlan,
  fields: ImportField[],
  id = () => crypto.randomUUID(),
): WorkspaceDraft {
  const next = structuredClone(draft);
  const selected = new Set(fields);
  // Imported captions are final text; disable only the corresponding auto-append.
  if (selected.has('prompt') && plan.prompt !== undefined) {
    next.prompt = plan.prompt;
    if (next.qualityTags !== undefined) next.qualityTags = 'none';
  }
  if (selected.has('negativePrompt') && plan.negativePrompt !== undefined) {
    next.negativePrompt = plan.negativePrompt;
    if (next.ucPreset !== undefined) next.ucPreset = 'none';
  }
  if (selected.has('characters') && plan.characters !== undefined) {
    next.characters = plan.characters.map((c) => ({
      ...c,
      id: id(),
      enabled: true,
      cell: { row: 2, column: 2 },
    }));
    next.placement = 'auto';
  }
  if (selected.has('settings')) Object.assign(next, plan.settings);
  if (selected.has('seed') && plan.seed !== undefined) {
    next.seed = plan.seed;
    next.seedMode = 'fixed';
  }
  return next;
}

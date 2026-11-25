import type { WorkspaceReference } from '../../workspaceReference';
import {
  buildPreviewImageRequest,
  PreviewContractError,
  ImageRequestDraft,
  PreviewModelFamily,
} from '../backends/genVendors/naiPreviewContract';

export interface WorkspaceCharacter {
  id: string;
  enabled: boolean;
  prompt: string;
  negativePrompt: string;
  cell: { row: number; column: number };
}

export interface WorkspaceDraft {
  reference?: WorkspaceReference;
  family: PreviewModelFamily;
  prompt: string;
  negativePrompt: string;
  characters: WorkspaceCharacter[];
  placement: 'auto' | 'manual';
  resolution: 'portrait' | 'landscape' | 'square';
  seedMode: 'random' | 'fixed';
  seed: string;
  steps: string;
  guidance: string;
  qualityTags?: 'none' | 'light' | 'standard';
  ucPreset?: 'none' | 'light' | 'heavy' | 'human' | 'furry';
}

export type PreviewRequest = ReturnType<typeof buildPreviewImageRequest>;
export type PreviewScenario = 'success' | 'prompt-length' | 'connection';

export interface WorkspaceResult {
  id: number;
  image: string;
  request: PreviewRequest;
  sceneName?: string;
}

export interface WorkspaceScene {
  id: string;
  name: string;
  draft: WorkspaceDraft;
}

export interface WorkspaceState {
  scenes: WorkspaceScene[];
  selectedSceneId: string;
  draft: WorkspaceDraft;
  selectedCharacter: string;
  results: WorkspaceResult[];
  selectedResult: number;
  scenario: PreviewScenario;
}

export function createWorkspaceState(): WorkspaceState {
  const draft: WorkspaceDraft = {
    family: 'v4.5',
    prompt: 'two travelers, quiet garden, afternoon light',
    negativePrompt: 'blur, text',
    characters: [
      {
        id: 'character-1',
        enabled: true,
        prompt: 'person, red coat',
        negativePrompt: 'hat',
        cell: { row: 2, column: 1 },
      },
      {
        id: 'character-2',
        enabled: true,
        prompt: 'person, blue coat',
        negativePrompt: 'scarf',
        cell: { row: 2, column: 3 },
      },
    ],
    placement: 'auto',
    resolution: 'portrait',
    seedMode: 'random',
    seed: '0',
    steps: '28',
    guidance: '5',
  };
  const names = ['정원의 여행자', '저녁의 정원', '비 오는 정원'];
  const scenes = names.map((name, index) => ({
    id: `scene-${index + 1}`,
    name,
    draft: {
      ...structuredClone(draft),
      prompt: [
        draft.prompt,
        'two travelers, garden at dusk',
        'two travelers, garden, rain',
      ][index],
    },
  }));
  return {
    draft: structuredClone(scenes[0].draft),
    scenes,
    selectedSceneId: scenes[0].id,
    selectedCharacter: 'character-1',
    results: [],
    selectedResult: 0,
    scenario: 'success',
  };
}

const sizes = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
};

export function projectWorkspaceDraft(
  draft: WorkspaceDraft,
  randomSeed?: number,
): PreviewRequest {
  const number = (value: string) => (value.trim() === '' ? NaN : Number(value));
  const input: ImageRequestDraft = {
    version: 1,
    family: draft.family,
    prompt: draft.prompt,
    negativePrompt: draft.negativePrompt,
    characters: draft.characters.map((character) => {
      const { row, column } = character.cell;
      if (
        ![row, column].every(
          (value) => Number.isInteger(value) && value >= 0 && value < 5,
        )
      )
        throw new PreviewContractError(
          'INVALID_GRID_CELL',
          'Invalid preview grid cell',
        );
      return {
        id: character.id,
        enabled: character.enabled,
        prompt: character.prompt,
        negativePrompt: character.negativePrompt,
        // Logical canvas centers for this offline example, not verified API quantization.
        position: { x: (column + 0.5) / 5, y: (row + 0.5) / 5 },
      };
    }),
    placement: draft.placement,
    ...sizes[draft.resolution],
    seed:
      draft.seedMode === 'random' ? (randomSeed ?? NaN) : number(draft.seed),
    steps: number(draft.steps),
    guidance: number(draft.guidance),
    cfgRescale: 0,
    sampler: 'fixture-sampler',
    noiseSchedule: 'fixture-noise-schedule',
  };
  return buildPreviewImageRequest(input, 'fixture-model-not-for-api');
}

export function moveWorkspaceCharacter(
  characters: WorkspaceCharacter[],
  id: string,
  direction: -1 | 1,
): WorkspaceCharacter[] {
  const from = characters.findIndex((character) => character.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= characters.length) return characters;
  const result = [...characters];
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}

export function previewErrorMessage(error: unknown): string {
  const { code, field } = (error ?? {}) as { code?: string; field?: string };
  const messages: Record<string, string> = {
    PROMPT_TOO_LONG:
      '프롬프트가 모델의 입력 한도를 넘었습니다. 기본·캐릭터 프롬프트를 줄인 뒤 다시 시도해주세요.',
    QUEUE_BUSY: '현재 예제를 마친 뒤 예약해주세요.',
    QUEUE_LIMIT: '반복은 1~10회, 예약은 최대 60개입니다.',
    CONNECTION:
      '연결을 완료하지 못했습니다. 입력은 그대로 유지됩니다. 잠시 후 다시 시도해주세요.',
    INLINE_SYNTAX:
      '이 초안에서는 | 문법을 사용할 수 없습니다. 캐릭터별 입력란을 사용해주세요.',
    EMPTY_PROMPT: '기본 프롬프트 또는 활성 캐릭터 프롬프트를 입력해주세요.',
    EMPTY_CHARACTER_PROMPT: '활성 캐릭터의 프롬프트를 입력해주세요.',
    CHARACTER_LIMIT:
      '선택한 모델 초안의 캐릭터 수를 초과했습니다. 일부 캐릭터를 꺼주세요.',
  };
  if (code === 'INVALID_NUMBER') {
    if (field === 'seed')
      return '시드는 0부터 4294967295 사이의 정수로 입력해주세요.';
    if (field === 'steps') return '스텝은 1 이상의 정수로 입력해주세요.';
    if (field === 'guidance')
      return '가이던스는 0 이상의 유한한 숫자로 입력해주세요.';
  }
  return (
    messages[code ?? ''] ??
    '입력값을 확인한 뒤 다시 시도해주세요. 초안은 그대로 유지됩니다.'
  );
}

/** The selected editor draft is authoritative until selection or reservation. */
export function snapshotWorkspaceScenes(
  state: WorkspaceState,
): WorkspaceScene[] {
  return structuredClone(
    state.scenes.map((scene) =>
      scene.id === state.selectedSceneId
        ? { ...scene, draft: state.draft }
        : scene,
    ),
  );
}

export function selectWorkspaceScene(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  const scenes = snapshotWorkspaceScenes(state);
  const scene = scenes.find((item) => item.id === id);
  if (!scene) return state;
  return {
    ...state,
    scenes,
    selectedSceneId: id,
    draft: structuredClone(scene.draft),
    selectedCharacter: scene.draft.characters[0]?.id ?? '',
  };
}

export function randomWorkspaceSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

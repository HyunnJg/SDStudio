import {
  buildPreviewImageRequest,
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
  family: PreviewModelFamily;
  prompt: string;
  negativePrompt: string;
  characters: WorkspaceCharacter[];
  placement: 'auto' | 'manual';
  resolution: 'portrait' | 'landscape' | 'square';
  seed: string;
  steps: string;
  guidance: string;
}

export type PreviewRequest = ReturnType<typeof buildPreviewImageRequest>;
export type PreviewScenario = 'success' | 'prompt-length' | 'connection';

export interface WorkspaceResult {
  id: number;
  image: string;
  request: PreviewRequest;
}

export interface WorkspaceState {
  draft: WorkspaceDraft;
  selectedCharacter: string;
  results: WorkspaceResult[];
  selectedResult: number;
  scenario: PreviewScenario;
}

export function createWorkspaceState(): WorkspaceState {
  return {
    draft: {
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
      seed: '0',
      steps: '28',
      guidance: '5',
    },
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

export function projectWorkspaceDraft(draft: WorkspaceDraft): PreviewRequest {
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
        throw new Error('Invalid preview grid cell');
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
    seed: number(draft.seed),
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
  const code = (error as { code?: string })?.code;
  if (code === 'PROMPT_TOO_LONG')
    return '프롬프트가 모델의 입력 한도를 넘었습니다. 기본·캐릭터 프롬프트를 줄인 뒤 다시 시도해주세요.';
  if (code === 'CONNECTION')
    return '연결을 완료하지 못했습니다. 입력은 그대로 유지됩니다. 잠시 후 다시 시도해주세요.';
  const message = error instanceof Error ? error.message : '';
  if (message.includes('Inline'))
    return '이 초안에서는 | 문법을 사용할 수 없습니다. 캐릭터별 입력란을 사용해주세요.';
  if (message.includes('base prompt'))
    return '기본 프롬프트 또는 활성 캐릭터 프롬프트를 입력해주세요.';
  if (message.includes('character prompt is empty'))
    return '활성 캐릭터의 프롬프트를 입력해주세요.';
  if (message.includes('Too many'))
    return '선택한 모델 초안의 캐릭터 수를 초과했습니다. 일부 캐릭터를 꺼주세요.';
  if (message.includes('seed'))
    return '시드는 0부터 4294967295 사이의 정수로 입력해주세요.';
  if (message.includes('steps')) return '스텝은 1 이상의 정수로 입력해주세요.';
  if (message.includes('guidance'))
    return '가이던스는 0 이상의 유한한 숫자로 입력해주세요.';
  return '입력값을 확인한 뒤 다시 시도해주세요. 초안은 그대로 유지됩니다.';
}

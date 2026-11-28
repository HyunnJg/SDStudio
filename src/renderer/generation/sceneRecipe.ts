import { characterLimit } from '../../workspaceCatalog';
import type { PromptPreset } from '../../promptLibrary';
import type { SuggestedCut } from '../../recipeAssistant';
import type { WorkspaceDraft, WorkspaceScene } from '../preview/workspaceDraft';

export interface SceneRecipe {
  name: string;
  styleId: string;
  characterIds: string[];
  cutActorId?: string;
  referenceByCharacter?: Record<string, string>;
  situations: {
    name: string;
    setting: string;
    emotion: string;
    characterId?: string;
    cutMode?: 'append' | 'replace';
    img2imgStrength?: string;
    included?: boolean;
  }[];
}

export const blankRecipe = (): SceneRecipe => ({
  name: '',
  styleId: '',
  characterIds: [],
  situations: [{ name: '', setting: '', emotion: '' }],
});

export const emotionCuts = [
  ['기쁨', 'happy, smile'],
  ['슬픔', 'sad, tears'],
  ['분노', 'angry, furrowed brow, clenched teeth'],
  ['공포', 'scared, wide-eyed, trembling'],
  ['놀람', 'surprised, open mouth'],
  ['혐오', 'disgust, grimace'],
  ['신뢰', 'looking at viewer, light smile'],
  ['기대', 'excited, sparkling eyes'],
  ['당황', 'embarrassed, flustered, blush'],
  ['질투', 'jealous, looking to the side, pout'],
].map(([name, emotion]) => ({ name, emotion }));

export function recipeHasPlaceholder(rows: SceneRecipe['situations']) {
  const [row] = rows;
  return (
    rows.length === 1 &&
    !row.cutMode &&
    !row.name &&
    !row.setting &&
    !row.emotion &&
    !row.characterId &&
    row.included !== false
  );
}

export function appendSuggestedCuts(
  recipe: SceneRecipe,
  cuts: SuggestedCut[],
  useCharacter: boolean,
): SceneRecipe {
  const existing = recipeHasPlaceholder(recipe.situations)
    ? []
    : recipe.situations;
  if (!cuts.length || existing.length + cuts.length > 60)
    throw Error('조합의 컷은 최대 60개입니다.');
  return {
    ...recipe,
    situations: [
      ...existing,
      ...cuts.map((cut) => ({
        ...cut,
        ...(useCharacter && cut.emotion ? { cutMode: 'append' as const } : {}),
      })),
    ],
  };
}

export function validCutStrength(value: string) {
  return (
    typeof value === 'string' &&
    (value === '' ||
      (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number(value) <= 1))
  );
}

// A cut follows a blank line. A single-paragraph identity has no replaceable suffix.
export function cutParagraphStart(prompt: string) {
  const breaks = [...prompt.trimEnd().matchAll(/\r?\n(?:[ \t]*\r?\n)+/g)];
  const last = breaks.at(-1);
  return last && prompt.slice(0, last.index).trim()
    ? last.index! + last[0].length
    : undefined;
}

export function resolveCutActor(
  actors: WorkspaceDraft['characters'],
  targetId?: string,
) {
  if (targetId) return actors.find((c) => c.id === targetId);
  return actors.length === 1 ? actors[0] : undefined;
}

export function validRecipe(r: SceneRecipe) {
  const text = (s: unknown, max: number) =>
    typeof s === 'string' && s.length <= max;
  return (
    r &&
    text(r.name, 120) &&
    text(r.styleId, 128) &&
    (r.cutActorId === undefined || text(r.cutActorId, 128)) &&
    Array.isArray(r.characterIds) &&
    r.characterIds.length <= 60 &&
    r.characterIds.every((id) => text(id, 128)) &&
    new Set(r.characterIds).size === r.characterIds.length &&
    (!r.referenceByCharacter ||
      (typeof r.referenceByCharacter === 'object' &&
        !Array.isArray(r.referenceByCharacter) &&
        Object.entries(r.referenceByCharacter).every(
          ([id, ref]) => r.characterIds.includes(id) && text(ref, 100),
        ))) &&
    Array.isArray(r.situations) &&
    r.situations.length > 0 &&
    r.situations.length <= 60 &&
    r.situations.every(
      (s) =>
        s &&
        text(s.name, 120) &&
        text(s.setting, 4096) &&
        text(s.emotion, 4096) &&
        (s.included === undefined || typeof s.included === 'boolean') &&
        (s.cutMode === undefined ||
          s.cutMode === 'append' ||
          s.cutMode === 'replace') &&
        (s.img2imgStrength === undefined ||
          (!!s.cutMode && validCutStrength(s.img2imgStrength))) &&
        (!s.characterId || r.characterIds.includes(s.characterId)),
    )
  );
}

export function recipeJobs(recipe: SceneRecipe) {
  const ids = recipe.characterIds.length ? recipe.characterIds : [''];
  return ids.flatMap((characterId) =>
    recipe.situations.flatMap((row, index) =>
      row.included === false ||
      (row.characterId && row.characterId !== characterId)
        ? []
        : [{ characterId, row, index }],
    ),
  );
}

export function buildRecipeScenes(
  recipe: SceneRecipe,
  base: WorkspaceScene,
  presets: PromptPreset[],
  remaining: number,
  uuid: () => string,
  sources: WorkspaceScene[] = [],
): WorkspaceScene[] {
  if (!validRecipe(recipe)) throw Error('조합 입력을 확인하세요.');
  const jobs = recipeJobs(recipe);
  if (jobs.length > remaining)
    throw Error('프로젝트의 남은 씬 수를 초과합니다.');
  const preset = (id: string, kind: PromptPreset['kind']) => {
    const found = presets.find(
      (p) => !p.deleted && p.kind === kind && p.id === id,
    );
    if (!found)
      throw Error('조합에 저장한 프리셋을 찾을 수 없습니다. 다시 선택하세요.');
    return found;
  };
  const style = recipe.styleId ? preset(recipe.styleId, 'main') : undefined;
  if (recipe.characterIds.length && !characterLimit(base.draft))
    throw Error('캐릭터를 지원하는 모델을 선택하세요.');
  const join = (...parts: string[]) => parts.filter((p) => p.trim()).join(', ');
  return jobs.map(({ characterId, row, index }) => {
    const character = characterId
      ? preset(characterId, 'character')
      : undefined;
    const draft: WorkspaceDraft = structuredClone(base.draft);
    const ref = recipe.referenceByCharacter?.[characterId];
    if (ref === 'none') delete draft.reference;
    else if (ref) {
      const source = sources.find((s) => s.draft.reference?.id === ref)?.draft
        .reference;
      if (!source)
        throw Error(
          '조합에 선택한 참조를 이 프로젝트에서 찾을 수 없습니다. 다시 선택하세요.',
        );
      draft.reference = structuredClone(source);
    }
    if (style) {
      draft.prompt = style.prompt;
      draft.negativePrompt = style.negativePrompt;
      if (draft.family === 'v5') {
        draft.qualityTags = style.qualityTags ?? 'none';
        draft.ucPreset = style.ucPreset ?? 'none';
      }
    }
    draft.prompt = join(draft.prompt, row.setting);
    if (character)
      draft.characters = [
        {
          id: character.id,
          enabled: true,
          prompt: character.prompt,
          negativePrompt: character.negativePrompt,
          cell: { row: 2, column: 2 },
        },
      ];
    if (row.cutMode) {
      const actors = draft.characters.filter(
        (c) => c.enabled && c.prompt.trim(),
      );
      const actor = resolveCutActor(actors, character?.id ?? recipe.cutActorId);
      if (!characterLimit(draft) || !actor)
        throw Error('컷을 적용할 활성 캐릭터 카드를 선택하세요.');
      if (!row.emotion.trim()) throw Error('예약할 컷의 문단을 입력하세요.');
      if (row.cutMode === 'replace') {
        const start = cutParagraphStart(actor.prompt);
        if (start === undefined)
          throw Error(
            '고정할 문단과 교체할 마지막 문단 사이에 빈 줄이 필요합니다. 문단 추가도 선택할 수 있습니다.',
          );
        actor.prompt = actor.prompt.slice(0, start) + row.emotion.trim();
      } else {
        const separator = actor.prompt.includes('\r\n') ? '\r\n\r\n' : '\n\n';
        actor.prompt = actor.prompt.trimEnd() + separator + row.emotion.trim();
      }
      if (row.img2imgStrength) {
        if (!draft.img2img)
          throw Error(
            '컷의 I2I 강도를 적용하려면 현재 씬에 변형 원본을 추가하세요.',
          );
        draft.img2img.strength = Number(row.img2imgStrength);
      }
    } else {
      const actor = draft.characters.find((c) => c.enabled && c.prompt.trim());
      if (actor) actor.prompt = join(actor.prompt, row.emotion);
      else draft.prompt = join(draft.prompt, row.emotion);
    }
    const name = [
      recipe.name || base.name,
      character?.name,
      row.name || String(index + 1),
    ]
      .filter(Boolean)
      .join(' · ');
    if (name.length > 120)
      throw Error('조합 이름이 너무 깁니다. 묶음이나 상황 이름을 줄여주세요.');
    return { id: uuid(), name, draft };
  });
}

import { characterLimit } from '../../workspaceCatalog';
import type { PromptPreset } from '../../promptLibrary';
import type { WorkspaceDraft, WorkspaceScene } from '../preview/workspaceDraft';

export interface SceneRecipe {
  name: string;
  styleId: string;
  characterIds: string[];
  referenceByCharacter?: Record<string, string>;
  situations: {
    name: string;
    setting: string;
    emotion: string;
    characterId?: string;
  }[];
}

export const blankRecipe = (): SceneRecipe => ({
  name: '',
  styleId: '',
  characterIds: [],
  situations: [{ name: '', setting: '', emotion: '' }],
});

export function validRecipe(r: SceneRecipe) {
  const text = (s: unknown, max: number) =>
    typeof s === 'string' && s.length <= max;
  return (
    r &&
    text(r.name, 120) &&
    text(r.styleId, 128) &&
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
        (!s.characterId || r.characterIds.includes(s.characterId)),
    )
  );
}

export function recipeJobs(recipe: SceneRecipe) {
  const ids = recipe.characterIds.length ? recipe.characterIds : [''];
  return ids.flatMap((characterId) =>
    recipe.situations.flatMap((row, index) =>
      row.characterId && row.characterId !== characterId
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
    const actor = draft.characters.find((c) => c.enabled && c.prompt.trim());
    if (actor) actor.prompt = join(actor.prompt, row.emotion);
    else draft.prompt = join(draft.prompt, row.emotion);
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

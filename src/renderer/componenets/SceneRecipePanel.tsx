/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState } from 'react';
import type { PromptPreset } from '../../promptLibrary';
import type { WorkspaceScene } from '../preview/workspaceDraft';
import {
  blankRecipe,
  buildRecipeScenes,
  validRecipe,
  recipeJobs,
  SceneRecipe,
} from '../generation/sceneRecipe';

const storageKey = 'sdstudio.scene-recipes.v1';
function readRecipes(): SceneRecipe[] {
  const items = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
  if (!Array.isArray(items) || !items.every(validRecipe))
    throw Error('저장된 조합을 읽을 수 없습니다.');
  return items;
}

export default function SceneRecipePanel({
  presets,
  base,
  repeats,
  sources,
  disabled,
  canPrepare,
  onCreate,
}: {
  presets: PromptPreset[];
  base: WorkspaceScene;
  sources: WorkspaceScene[];
  canPrepare: boolean;
  repeats: number;
  disabled: boolean;
  onCreate: (scenes: WorkspaceScene[]) => void;
}) {
  const [recipe, setRecipe] = useState(blankRecipe);
  const [saved, setSaved] = useState<SceneRecipe[]>(() => {
    try {
      return readRecipes();
    } catch {
      return [];
    }
  });
  const [error, setError] = useState('');
  const edit = (data: Partial<SceneRecipe>) => {
    setRecipe({ ...recipe, ...data });
    setError('');
  };
  const visible = presets.filter((p) => !p.deleted);
  const jobs = recipeJobs(recipe);
  const count = jobs.length;
  const references = new Map(
    sources
      .filter((s) => s.draft.reference)
      .map((s) => [s.draft.reference!.id, s.name]),
  );
  const refCount = jobs.filter(({ characterId }) => {
    const selected = recipe.referenceByCharacter?.[characterId];
    return selected ? selected !== 'none' : !!base.draft.reference;
  }).length;
  const save = () => {
    try {
      const items = readRecipes().filter((r) => r.name !== recipe.name);
      items.push(recipe);
      localStorage.setItem(storageKey, JSON.stringify(items));
      setSaved(items);
      setError('');
    } catch {
      setError('조합을 저장할 수 없습니다.');
    }
  };
  return (
    <details className="workspace-saved-presets" data-testid="scene-recipe">
      <summary>조합으로 예약</summary>
      <fieldset disabled={disabled}>
        <label>
          저장한 조합
          <select
            value=""
            onChange={(e) => {
              const r = saved.find((s) => s.name === e.target.value);
              setRecipe(r ?? blankRecipe());
              setError('');
            }}
          >
            <option value="" disabled>
              조합 불러오기
            </option>
            <option value=" ">새 조합</option>
            {saved.map((r) => (
              <option key={r.name}>{r.name}</option>
            ))}
          </select>
        </label>
        <label>
          조합 이름
          <input
            maxLength={120}
            value={recipe.name}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label>
          공통 화풍
          <select
            value={recipe.styleId}
            onChange={(e) => edit({ styleId: e.target.value })}
          >
            <option value="">현재 씬의 메인 입력</option>
            {visible
              .filter((p) => p.kind === 'main')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend>교대로 사용할 캐릭터</legend>
          {visible
            .filter((p) => p.kind === 'character')
            .map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={recipe.characterIds.includes(p.id)}
                  onChange={(e) => {
                    const ids = e.target.checked
                      ? [...recipe.characterIds, p.id]
                      : recipe.characterIds.filter((id) => id !== p.id);
                    const refs = { ...recipe.referenceByCharacter };
                    if (!ids.includes(p.id)) delete refs[p.id];
                    edit({
                      characterIds: ids,
                      referenceByCharacter: refs,
                      situations: recipe.situations.map((row) =>
                        row.characterId === p.id && !ids.includes(p.id)
                          ? { ...row, characterId: '' }
                          : row,
                      ),
                    });
                  }}
                />
                {p.name}
              </label>
            ))}
        </fieldset>
        {(references.size > 0 ||
          Object.keys(recipe.referenceByCharacter ?? {}).length > 0) &&
          recipe.characterIds.map((id) => (
            <label key={id}>
              {visible.find((p) => p.id === id)?.name} 참조
              <select
                value={recipe.referenceByCharacter?.[id] ?? ''}
                onChange={(e) =>
                  edit({
                    referenceByCharacter: {
                      ...recipe.referenceByCharacter,
                      [id]: e.target.value,
                    },
                  })
                }
              >
                <option value="">현재 씬과 같게</option>
                <option value="none">참조 끄기</option>
                {[...references].map(([ref, name]) => (
                  <option value={ref} key={ref}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {recipe.situations.map((row, i) => (
          // Rows are controlled inputs with no component-local state.
          // eslint-disable-next-line react/no-array-index-key
          <fieldset key={i}>
            <legend>상황 {i + 1}</legend>
            {(['name', 'setting', 'emotion'] as const).map((key, k) => (
              <label key={key}>
                {['이름', '배경·상황', '표정·감정'][k]}
                <input
                  maxLength={key === 'name' ? 120 : 4096}
                  value={row[key]}
                  onChange={(e) =>
                    edit({
                      situations: recipe.situations.map((s, j) =>
                        j === i ? { ...s, [key]: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
            ))}
            {recipe.characterIds.length > 1 && (
              <label>
                대상
                <select
                  value={row.characterId ?? ''}
                  onChange={(e) =>
                    edit({
                      situations: recipe.situations.map((r, j) =>
                        i === j ? { ...r, characterId: e.target.value } : r,
                      ),
                    })
                  }
                >
                  <option value="">선택한 캐릭터 모두</option>
                  {recipe.characterIds.map((id) => (
                    <option key={id} value={id}>
                      {visible.find((p) => p.id === id)?.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {recipe.situations.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  edit({
                    situations: recipe.situations.filter((_, j) => j !== i),
                  })
                }
              >
                상황 제거
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={recipe.situations.length >= 60}
          onClick={() =>
            edit({
              situations: [
                ...recipe.situations,
                { name: '', setting: '', emotion: '' },
              ],
            })
          }
        >
          상황 추가
        </button>
        <button type="button" disabled={!recipe.name.trim()} onClick={save}>
          조합 저장
        </button>
        <p>
          {count}씬 × {repeats}회 · {count * repeats}장
          {refCount > 0 && ` · 참조 추가분 ${5 * refCount * repeats} Anlas`}
        </p>
        <button
          data-testid="prepare-recipe"
          type="button"
          disabled={
            !canPrepare ||
            !count ||
            !Number.isInteger(repeats) ||
            repeats < 1 ||
            count * repeats > 60
          }
          onClick={() => {
            try {
              onCreate(
                buildRecipeScenes(
                  recipe,
                  base,
                  presets,
                  60,
                  () => crypto.randomUUID(),
                  sources,
                ),
              );
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {count * repeats}장 예약 검토
        </button>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </details>
  );
}

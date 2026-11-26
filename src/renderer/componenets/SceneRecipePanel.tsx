/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState } from 'react';
import type { PromptPreset } from '../../promptLibrary';
import type { WorkspaceScene } from '../preview/workspaceDraft';
import {
  blankRecipe,
  buildRecipeScenes,
  validRecipe,
  validCutStrength,
  cutParagraphStart,
  recipeJobs,
  resolveCutActor,
  SceneRecipe,
} from '../generation/sceneRecipe';

const storageKey = 'sdstudio.scene-recipes.v2';
const legacyKey = 'sdstudio.scene-recipes.v1';
function readRecipes(): SceneRecipe[] {
  const items = JSON.parse(
    localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey) ?? '[]',
  );
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
  type Row = SceneRecipe['situations'][number];
  const editRow = (index: number, patch: Partial<Row>) =>
    edit({
      situations: recipe.situations.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  const addCut = () => {
    const row: Row = { name: '', setting: '', emotion: '', cutMode: 'append' };
    const first = recipe.situations[0];
    const empty =
      recipe.situations.length === 1 &&
      !first.cutMode &&
      !first.name &&
      !first.setting &&
      !first.emotion &&
      !first.characterId &&
      first.included !== false;
    edit({ situations: empty ? [row] : [...recipe.situations, row] });
  };
  const actors = base.draft.characters.filter(
    (c) => c.enabled && c.prompt.trim(),
  );
  const currentActor = resolveCutActor(actors, recipe.cutActorId);
  let sourcePrompt = currentActor?.prompt;
  if (recipe.characterIds.length) {
    sourcePrompt =
      recipe.characterIds.length === 1
        ? visible.find(
            (p) => p.kind === 'character' && p.id === recipe.characterIds[0],
          )?.prompt
        : undefined;
  }
  const start = sourcePrompt ? cutParagraphStart(sourcePrompt) : undefined;
  const hasCuts = recipe.situations.some((row) => row.cutMode);
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
      if (!validRecipe(recipe)) {
        setError('조합 입력과 컷의 I2I 강도(0~1)를 확인하세요.');
        return;
      }
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
        {hasCuts &&
          !recipe.characterIds.length &&
          (actors.length > 1 || !!recipe.cutActorId) && (
            <label>
              컷을 적용할 현재 씬의 카드
              <select
                value={recipe.cutActorId ?? ''}
                onChange={(e) => edit({ cutActorId: e.target.value })}
              >
                <option value="">
                  {actors.length === 1 ? '활성 카드 사용' : '카드 선택'}
                </option>
                {actors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.prompt.split('\n')[0].slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
          )}
        {recipe.situations.map((row, i) => (
          // Rows are controlled inputs with no component-local state.
          // eslint-disable-next-line react/no-array-index-key
          <fieldset key={i}>
            <legend>
              {row.cutMode ? '캐릭터 컷' : '상황'} {i + 1}
            </legend>
            {row.cutMode && (
              <label>
                <input
                  type="checkbox"
                  checked={row.included !== false}
                  onChange={(e) => editRow(i, { included: e.target.checked })}
                />
                이번 예약에 포함
              </label>
            )}
            {(['name', 'setting', 'emotion'] as const)
              .filter((key) => !row.cutMode || key === 'name')
              .map((key) => (
                <label key={key}>
                  {
                    {
                      name: '이름',
                      setting: '배경·상황',
                      emotion: '표정·감정',
                    }[key]
                  }
                  <input
                    maxLength={key === 'name' ? 120 : 4096}
                    value={row[key]}
                    onChange={(e) => editRow(i, { [key]: e.target.value })}
                  />
                </label>
              ))}
            {row.cutMode && (
              <>
                <label>
                  캐릭터 프롬프트 적용 방식
                  <select
                    value={row.cutMode}
                    onChange={(e) =>
                      editRow(i, { cutMode: e.target.value as Row['cutMode'] })
                    }
                  >
                    <option value="append">외형·복장 뒤에 문단 추가</option>
                    <option value="replace">마지막 문단만 교체</option>
                  </select>
                </label>
                {row.cutMode === 'replace' && (
                  <small>빈 줄로 구분한 마지막 문단을 교체합니다.</small>
                )}
                <label>
                  컷 문단
                  <textarea
                    rows={4}
                    maxLength={4096}
                    value={row.emotion}
                    placeholder="표정, 손동작, 구도, 배경, 소품"
                    onChange={(e) => editRow(i, { emotion: e.target.value })}
                  />
                </label>
                {sourcePrompt && start !== undefined && !row.emotion && (
                  <button
                    type="button"
                    onClick={() =>
                      editRow(i, {
                        emotion: sourcePrompt.slice(start).trimEnd(),
                        cutMode: 'replace',
                      })
                    }
                    data-testid="capture-cut"
                    disabled={sourcePrompt.slice(start).trimEnd().length > 4096}
                  >
                    카드의 마지막 문단 가져오기
                  </button>
                )}
                {(base.draft.img2img || row.img2imgStrength) && (
                  <label>
                    이 컷의 I2I 강도 (0~1)
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={16}
                      placeholder={`씬 설정 사용 (${base.draft.img2img?.strength ?? '원본 없음'})`}
                      value={row.img2imgStrength ?? ''}
                      aria-invalid={
                        !validCutStrength(row.img2imgStrength ?? '')
                      }
                      onChange={(e) =>
                        editRow(i, { img2imgStrength: e.target.value })
                      }
                    />
                  </label>
                )}
              </>
            )}
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
                {row.cutMode ? '컷 제거' : '상황 제거'}
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
        <button
          type="button"
          disabled={recipe.situations.length >= 60}
          data-testid="add-recipe-cut"
          onClick={addCut}
        >
          캐릭터 컷 추가
        </button>
        <button
          data-testid="save-recipe"
          type="button"
          disabled={!recipe.name.trim()}
          onClick={save}
        >
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

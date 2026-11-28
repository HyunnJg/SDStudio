/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import RecipeAssistant from './RecipeAssistant';
import { characterLimit } from '../../workspaceCatalog';
import {
  sceneReferences,
  REFERENCE_ANLAS,
  REFERENCE_ROLES,
} from '../../workspaceReference';
import type { PromptPreset } from '../../promptLibrary';
import type { WorkspaceScene } from '../preview/workspaceDraft';
import {
  blankRecipe,
  appendSuggestedCuts,
  emotionCuts,
  recipeHasPlaceholder,
  buildRecipeScenes,
  validRecipe,
  validCutStrength,
  cutParagraphStart,
  recipeJobs,
  recipeReferenceChoices,
  recipeReferences,
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
  onRepeats,
  vibeOpen,
  onVibeClose,
  onSettings,
  onReveal,
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
  onRepeats: (count: number) => void;
  vibeOpen: boolean;
  onVibeClose: () => void;
  onSettings: () => void;
  onReveal: () => void;
  disabled: boolean;
  onCreate: (scenes: WorkspaceScene[]) => void;
}) {
  const [recipe, setRecipe] = useState(blankRecipe);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const panel = useRef<HTMLDetailsElement>(null);
  const [deleteName, setDeleteName] = useState('');
  const [applied, setApplied] = useState<{
    before: SceneRecipe;
    after: SceneRecipe;
    beforeRepeats: number;
    afterRepeats: number;
  }>();
  const [storageName, setStorageName] = useState('');
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
    const empty = recipeHasPlaceholder(recipe.situations);
    edit({ situations: empty ? [row] : [...recipe.situations, row] });
  };
  const actors = base.draft.characters.filter(
    (c) => c.enabled && c.prompt.trim(),
  );
  const currentActor = resolveCutActor(actors, recipe.cutActorId);
  const useActor =
    !!characterLimit(base.draft) &&
    !!(recipe.characterIds.length || actors.length);
  const styleName = visible.find((p) => p.id === recipe.styleId)?.name ?? '';
  const characterNames = visible
    .filter((p) => recipe.characterIds.includes(p.id))
    .map((p) => p.name);
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
  const references = recipeReferenceChoices(sources);
  const currentCards = sceneReferences(base.draft);
  const jobCards = jobs.map(({ characterId }) =>
    recipeReferences(
      currentCards,
      recipe.referenceByCharacter?.[characterId],
      references,
    ),
  );
  const missingReference = jobCards.some((cards) => !cards);
  const refCount = jobCards.reduce((n, cards) => n + (cards?.length ?? 0), 0);
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
      setStorageName(recipe.name);
      setDeleteName('');
      setError('');
    } catch {
      setError('조합을 저장할 수 없습니다.');
    }
  };
  return (
    <details
      ref={panel}
      className="workspace-saved-presets"
      data-testid="scene-recipe"
    >
      <summary>조합으로 예약</summary>
      <fieldset disabled={disabled}>
        <label>
          저장한 조합
          <select
            value=""
            onChange={(e) => {
              const r = saved.find((s) => s.name === e.target.value);
              setRecipe(r ?? blankRecipe());
              setStorageName(r?.name ?? '');
              setDeleteName('');
              setLoaded((n) => n + 1);
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
        {storageName && (
          <button
            type="button"
            data-testid="delete-recipe"
            onClick={() => setDeleteName(storageName)}
          >
            저장한 조합 삭제
          </button>
        )}
        {deleteName && (
          <div role="group" aria-label="조합 삭제 확인">
            <p>‘{deleteName}’을 저장 목록에서 삭제할까요?</p>
            <button type="button" onClick={() => setDeleteName('')}>
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const next = readRecipes().filter(
                    (r) => r.name !== deleteName,
                  );
                  localStorage.setItem(storageKey, JSON.stringify(next));
                  setSaved(next);
                  setStorageName('');
                  setDeleteName('');
                  setError('');
                } catch {
                  setError('조합을 삭제할 수 없습니다.');
                }
              }}
            >
              삭제 확인
            </button>
          </div>
        )}
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
              {visible.find((p) => p.id === id)?.name} 첫 참조
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
                <option value="none">모든 참조 끄기</option>
                {recipe.referenceByCharacter?.[id] &&
                  recipe.referenceByCharacter[id] !== 'none' &&
                  !references.has(recipe.referenceByCharacter[id]) && (
                    <option value={recipe.referenceByCharacter[id]}>
                      {[...references.values()].find(
                        ({ card }) =>
                          card.id === recipe.referenceByCharacter?.[id],
                      )?.sceneName ?? '찾을 수 없는 참조'}
                    </option>
                  )}
                {[...references].map(([ref, { sceneName, card }]) => (
                  <option value={ref} key={ref}>
                    {sceneName} · {REFERENCE_ROLES[card.role]} · 강도{' '}
                    {card.strength}
                  </option>
                ))}
              </select>
            </label>
          ))}
        <details data-testid="emotion-cuts">
          <summary>기본 감정 10종</summary>
          <fieldset>
            <legend>
              {useActor
                ? '캐릭터 카드에 추가할 감정'
                : '메인 프롬프트에 추가할 감정'}
            </legend>
            <label>
              <input
                type="checkbox"
                checked={emotions.length === emotionCuts.length}
                onChange={(e) =>
                  setEmotions(
                    e.target.checked ? emotionCuts.map((cut) => cut.name) : [],
                  )
                }
              />
              전체 선택
            </label>
            {emotionCuts.map(({ name, emotion }) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={emotions.includes(name)}
                  onChange={(e) =>
                    setEmotions(
                      e.target.checked
                        ? [...emotions, name]
                        : emotions.filter((item) => item !== name),
                    )
                  }
                />
                {name} · {emotion}
              </label>
            ))}
            <button
              type="button"
              disabled={!emotions.length}
              onClick={() => {
                try {
                  const cuts = emotionCuts
                    .filter((cut) => emotions.includes(cut.name))
                    .map(({ name, emotion }) =>
                      useActor
                        ? { name, emotion, setting: '' }
                        : { name, emotion: '', setting: emotion },
                    );
                  const next = appendSuggestedCuts(recipe, cuts, useActor);
                  setApplied({
                    before: recipe,
                    after: next,
                    beforeRepeats: repeats,
                    afterRepeats: repeats,
                  });
                  setRecipe(next);
                  setEmotions([]);
                  setError('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              선택한 감정 {emotions.length}개 추가
            </button>
          </fieldset>
        </details>
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
        {applied && applied.after === recipe && (
          <button
            type="button"
            onClick={() => {
              setRecipe(applied.before);
              if (repeats === applied.afterRepeats)
                onRepeats(applied.beforeRepeats);
              setApplied(undefined);
              setError('');
            }}
          >
            방금 추가한 컷 되돌리기
          </button>
        )}
        {recipe.situations.map((row, i) => (
          // Rows are controlled inputs with no component-local state.
          // eslint-disable-next-line react/no-array-index-key
          <fieldset key={i}>
            <legend>
              {row.cutMode ? '캐릭터 컷' : '상황'} {i + 1}
            </legend>
            <label>
              <input
                type="checkbox"
                checked={row.included !== false}
                onChange={(e) => editRow(i, { included: e.target.checked })}
              />
              이번 예약에 포함
            </label>
            {(['name', 'setting', 'emotion'] as const)
              .filter((key) => !row.cutMode || key !== 'emotion')
              .map((key) => (
                <label key={key}>
                  {
                    {
                      name: '이름',
                      setting: '메인 입력에 추가',
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
                      editRow(i, {
                        cutMode: e.target.value as Row['cutMode'],
                      })
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
            {!recipeHasPlaceholder(recipe.situations) && (
              <button
                type="button"
                onClick={() =>
                  edit({
                    situations:
                      recipe.situations.length === 1
                        ? blankRecipe().situations
                        : recipe.situations.filter((_, j) => j !== i),
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
          {!missingReference &&
            refCount > 0 &&
            ` · 참조 추가분 ${REFERENCE_ANLAS * refCount * repeats} Anlas`}
          {missingReference &&
            ' · 찾을 수 없는 참조가 있습니다. 사용할 이미지를 다시 선택하세요.'}
          {count * repeats > 60 &&
            ' · 한 번에 60장까지 예약할 수 있습니다. 감정·인물 또는 반복 횟수를 줄이세요.'}
        </p>
        <button
          data-testid="prepare-recipe"
          type="button"
          disabled={
            !canPrepare ||
            missingReference ||
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
      {vibeOpen &&
        createPortal(
          <RecipeAssistant
            key={JSON.stringify([
              loaded,
              base.id,
              recipe.styleId,
              recipe.characterIds,
              recipe.cutActorId,
              styleName,
              characterNames,
            ])}
            disabled={disabled}
            onClose={onVibeClose}
            onSettings={onSettings}
            style={styleName}
            characters={characterNames}
            room={
              recipeHasPlaceholder(recipe.situations)
                ? 60
                : 60 - recipe.situations.length
            }
            onApply={(plan) => {
              const useCharacter =
                !!characterLimit(base.draft) &&
                !!(actors.length || recipe.characterIds.length);
              const next = appendSuggestedCuts(recipe, plan.cuts, useCharacter);
              setApplied({
                before: recipe,
                after: next,
                beforeRepeats: repeats,
                afterRepeats: plan.repeats || repeats,
              });
              setRecipe(next);
              setError('');
              if (panel.current) panel.current.open = true;
              onReveal();
              if (plan.repeats) onRepeats(plan.repeats);
            }}
          />,
          document.querySelector('.connected-workspace') ?? document.body,
        )}
    </details>
  );
}

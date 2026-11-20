import { Dispatch, SetStateAction } from 'react';
import {
  WorkspaceState,
  WorkspaceDraft,
  WorkspaceCharacter,
  moveWorkspaceCharacter,
} from '../preview/workspaceDraft';
import { previewCharacterLimits } from '../backends/genVendors/naiPreviewContract';

interface Props {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  updateDraft: (patch: Partial<WorkspaceDraft>) => void;
  updateCharacter: (patch: Partial<WorkspaceCharacter>) => void;
  addCharacter: () => void;
  removeCharacter: () => void;
  undoCharacter: () => void;
  canUndo: boolean;
}
export default function WorkspacePrompts({
  state,
  setState,
  updateDraft,
  updateCharacter,
  addCharacter,
  removeCharacter,
  undoCharacter,
  canUndo,
}: Props) {
  const { draft } = state;
  const character = draft.characters.find(
    (item) => item.id === state.selectedCharacter,
  );
  const active = draft.characters.filter((item) => item.enabled).length;
  const limit = previewCharacterLimits[draft.family];
  return (
    <section className="pw-prompts pw-panel" aria-label="프롬프트 편집">
      <div className="pw-section-title">
        <h1>장면을 그려보세요</h1>
        <span>입력 초안</span>
      </div>
      <label htmlFor="pw-prompt" className="pw-field">
        기본 프롬프트
        <textarea
          id="pw-prompt"
          data-testid="base-prompt"
          rows={4}
          value={draft.prompt}
          onChange={(event) => updateDraft({ prompt: event.target.value })}
          placeholder="장면, 분위기, 스타일을 입력하세요"
        />
      </label>
      <label htmlFor="pw-field-2" className="pw-field pw-negative">
        제외할 내용
        <textarea
          id="pw-field-2"
          aria-label="기본 부정 프롬프트"
          rows={2}
          value={draft.negativePrompt}
          onChange={(event) =>
            updateDraft({ negativePrompt: event.target.value })
          }
        />
      </label>
      <div className="pw-section-title pw-character-heading">
        <h2>캐릭터</h2>
        <span>
          {active} / {limit}명 활성 · 보관 {draft.characters.length}/32
        </span>
      </div>
      <div className="pw-character-tabs" role="group" aria-label="캐릭터 선택">
        {draft.characters.map((item, index) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={item.id === state.selectedCharacter}
            onClick={() =>
              setState((previous) => ({
                ...previous,
                selectedCharacter: item.id,
              }))
            }
            className={!item.enabled ? 'pw-muted-character' : ''}
          >
            캐릭터 {index + 1}
          </button>
        ))}
        <button
          type="button"
          className="pw-add-character"
          aria-label="캐릭터 추가"
          onClick={addCharacter}
          disabled={active >= limit || draft.characters.length >= 32}
        >
          ＋
        </button>
      </div>
      {active > limit && (
        <p role="alert" className="pw-limit-warning">
          활성 {active}명 / 한도 {limit}명 — 일부 캐릭터를 꺼주세요.
        </p>
      )}
      {canUndo && (
        <button type="button" onClick={undoCharacter}>
          캐릭터 삭제 취소
        </button>
      )}
      {character ? (
        <div className="pw-character-editor">
          <div className="pw-character-tools">
            <label htmlFor="pw-field-3">
              <input
                id="pw-field-3"
                type="checkbox"
                checked={character.enabled}
                onChange={(event) =>
                  updateCharacter({ enabled: event.target.checked })
                }
              />{' '}
              사용
            </label>
            <div>
              <button
                type="button"
                aria-label="캐릭터 앞으로"
                disabled={draft.characters[0]?.id === character.id}
                onClick={() =>
                  updateDraft({
                    characters: moveWorkspaceCharacter(
                      draft.characters,
                      character.id,
                      -1,
                    ),
                  })
                }
              >
                ↑ 앞으로
              </button>
              <button
                type="button"
                aria-label="캐릭터 뒤로"
                disabled={draft.characters.at(-1)?.id === character.id}
                onClick={() =>
                  updateDraft({
                    characters: moveWorkspaceCharacter(
                      draft.characters,
                      character.id,
                      1,
                    ),
                  })
                }
              >
                ↓ 뒤로
              </button>
              <button
                type="button"
                aria-label="캐릭터 삭제"
                onClick={removeCharacter}
              >
                삭제
              </button>
            </div>
          </div>
          <label htmlFor="pw-field-4" className="pw-field">
            캐릭터 프롬프트
            <textarea
              id="pw-field-4"
              aria-label="캐릭터 프롬프트"
              rows={3}
              value={character.prompt}
              onChange={(event) =>
                updateCharacter({ prompt: event.target.value })
              }
              placeholder="외모, 의상, 행동을 입력하세요"
            />
          </label>
          <label htmlFor="pw-field-5" className="pw-field pw-negative">
            캐릭터에서 제외할 내용
            <textarea
              id="pw-field-5"
              aria-label="캐릭터 부정 프롬프트"
              rows={2}
              value={character.negativePrompt}
              onChange={(event) =>
                updateCharacter({ negativePrompt: event.target.value })
              }
            />
          </label>
          <div className="pw-placement-heading">
            <span>캐릭터 위치</span>
            <div className="pw-toggle" role="group" aria-label="배치 방식">
              <button
                type="button"
                aria-pressed={draft.placement === 'auto'}
                onClick={() => updateDraft({ placement: 'auto' })}
              >
                자동
              </button>
              <button
                type="button"
                aria-pressed={draft.placement === 'manual'}
                onClick={() => updateDraft({ placement: 'manual' })}
              >
                직접 선택
              </button>
            </div>
          </div>
          {draft.placement === 'manual' ? (
            <div className="pw-grid-area">
              <div
                className="pw-position-grid"
                role="group"
                aria-label="캐릭터 위치 5행 5열"
              >
                {Array.from({ length: 25 }, (_, index) => {
                  const row = Math.floor(index / 5);
                  const column = index % 5;
                  const selected =
                    row === character.cell.row &&
                    column === character.cell.column;
                  return (
                    <button
                      type="button"
                      key={index}
                      aria-label={`위치 ${row + 1}행 ${column + 1}열`}
                      aria-pressed={selected}
                      onClick={() => updateCharacter({ cell: { row, column } })}
                    >
                      {selected ? '●' : ''}
                    </button>
                  );
                })}
              </div>
              <p>
                {character.cell.row + 1}행 {character.cell.column + 1}열
                <br />
                <span>예제 캔버스의 위치입니다.</span>
              </p>
            </div>
          ) : (
            <p className="pw-hint">입력 순서에 따라 자동으로 배치합니다.</p>
          )}
        </div>
      ) : (
        <p className="pw-hint">
          캐릭터 없이 장면만 만들거나, ＋로 캐릭터를 추가하세요.
        </p>
      )}
    </section>
  );
}

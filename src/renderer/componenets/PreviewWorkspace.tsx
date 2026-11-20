import { Dispatch, SetStateAction, useRef, useState } from 'react';
import { previewCharacterLimits } from '../backends/genVendors/naiPreviewContract';
import {
  WorkspaceState,
  WorkspaceDraft,
  WorkspaceCharacter,
  PreviewRequest,
  PreviewScenario,
  projectWorkspaceDraft,
  moveWorkspaceCharacter,
  previewErrorMessage,
} from '../preview/workspaceDraft';
import previewArtwork from '../preview/previewArtwork';
import './PreviewWorkspace.css';

interface Props {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  legacyName: string;
  legacySceneCount: number;
  onOpenLegacy: () => void;
  renderPreview: (
    request: PreviewRequest,
    scenario: PreviewScenario,
  ) => Promise<string>;
}

export default function PreviewWorkspace({
  state,
  setState,
  legacyName,
  legacySceneCount,
  onOpenLegacy,
  renderPreview,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextCharacter = useRef(3);
  const { draft } = state;
  const character = draft.characters.find(
    (item) => item.id === state.selectedCharacter,
  );
  const active = draft.characters.filter((item) => item.enabled).length;
  const limit = previewCharacterLimits[draft.family];
  const result = state.results.find((item) => item.id === state.selectedResult);
  const updateDraft = (patch: Partial<WorkspaceDraft>) => {
    setError('');
    setState((previous) => ({
      ...previous,
      draft: { ...previous.draft, ...patch },
    }));
  };
  const updateCharacter = (patch: Partial<WorkspaceCharacter>) => {
    if (!character) return;
    updateDraft({
      characters: draft.characters.map((item) =>
        item.id === character.id ? { ...item, ...patch } : item,
      ),
    });
  };
  const addCharacter = () => {
    // IDs survive view switches and are independent of the visible character order.
    const id = `character-${Date.now()}-${nextCharacter.current}`;
    nextCharacter.current += 1;
    setState((previous) => ({
      ...previous,
      selectedCharacter: id,
      draft: {
        ...previous.draft,
        characters: [
          ...previous.draft.characters,
          {
            id,
            enabled: true,
            prompt: '',
            negativePrompt: '',
            cell: { row: 2, column: 2 },
          },
        ],
      },
    }));
  };
  const generate = async () => {
    setError('');
    try {
      const request = projectWorkspaceDraft(draft);
      setBusy(true);
      const image = await renderPreview(request, state.scenario);
      setState((previous) => {
        const id = (previous.results[0]?.id ?? 0) + 1;
        return {
          ...previous,
          selectedResult: id,
          results: [{ id, image, request }, ...previous.results].slice(0, 6),
        };
      });
    } catch (failure) {
      setError(previewErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="preview-workspace" data-testid="preview-workspace">
      <header className="pw-header">
        <div className="pw-brand">
          <span className="pw-brand-mark" aria-hidden="true">
            S
          </span>
          <strong>SDStudio</strong>
          <span className="pw-brand-sub">작업실</span>
        </div>
        <nav aria-label="작업 화면">
          <span className="pw-current">새 입력 초안</span>
          <button
            type="button"
            onClick={onOpenLegacy}
            data-testid="open-legacy"
          >
            기존 V3 화면 <span aria-hidden="true">↗</span>
          </button>
        </nav>
        <span className="pw-offline">
          <span aria-hidden="true">●</span> 오프라인 예제
        </span>
      </header>
      <main className="pw-body">
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
              {active} / {limit}명 활성
            </span>
          </div>
          <div
            className="pw-character-tabs"
            role="group"
            aria-label="캐릭터 선택"
          >
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
              disabled={draft.characters.length >= limit}
            >
              ＋
            </button>
          </div>
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
                    ↑
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
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="캐릭터 삭제"
                    onClick={() => {
                      const remaining = draft.characters.filter(
                        (item) => item.id !== character.id,
                      );
                      setState((previous) => ({
                        ...previous,
                        selectedCharacter: remaining[0]?.id ?? '',
                        draft: { ...previous.draft, characters: remaining },
                      }));
                    }}
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
                          onClick={() =>
                            updateCharacter({ cell: { row, column } })
                          }
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

        <section className="pw-canvas-column" aria-label="결과 미리보기">
          <div className="pw-canvas-toolbar">
            <h2>미리보기</h2>
            <span>
              {result
                ? `예제 ${String(result.id).padStart(2, '0')}`
                : '아직 실행하지 않은 초안'}
            </span>
          </div>
          <div className={`pw-canvas ${!result ? 'pw-canvas-empty' : ''}`}>
            <img
              src={result?.image ?? previewArtwork()}
              alt={
                result
                  ? '직접 그린 정원 예제. AI 생성 결과가 아닙니다.'
                  : '예제 배경으로 사용할 정원 일러스트'
              }
            />
            {!result && (
              <div className="pw-canvas-welcome">
                <span aria-hidden="true">✦</span>
                <h2>어떤 장면을 만들까요?</h2>
                <p>
                  입력을 바꾼 뒤 예제 만들기를 눌러
                  <br />새 작업 흐름을 확인해보세요.
                </p>
              </div>
            )}
          </div>
          <div className="pw-result-caption">
            <span>
              {result
                ? '예제 일러스트 · 생성 모델 미연결'
                : '직접 그린 예제 일러스트'}
            </span>
            {result && <span>시드 {result.request.parameters.seed}</span>}
          </div>
          <div className="pw-history">
            <div className="pw-section-title">
              <h2>예제 기록</h2>
              <span>{state.results.length}개 · 메모리 보관</span>
            </div>
            <div className="pw-history-strip">
              {state.results.length ? (
                state.results.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-label={`예제 ${item.id} 선택`}
                    aria-pressed={item.id === state.selectedResult}
                    onClick={() =>
                      setState((previous) => ({
                        ...previous,
                        selectedResult: item.id,
                      }))
                    }
                  >
                    <img src={item.image} alt="" />
                    <span>{String(item.id).padStart(2, '0')}</span>
                  </button>
                ))
              ) : (
                <p>실행한 예제가 여기에 모입니다.</p>
              )}
            </div>
          </div>
        </section>

        <aside className="pw-settings pw-panel" aria-label="생성 설정">
          <div className="pw-section-title">
            <h2>생성 설정</h2>
            <span>예제 값</span>
          </div>
          <label htmlFor="pw-field-6" className="pw-field">
            모델 입력 형식
            <select
              id="pw-field-6"
              aria-label="모델 입력 형식"
              value={draft.family}
              onChange={(event) =>
                updateDraft({
                  family: event.target.value as WorkspaceDraft['family'],
                })
              }
            >
              <option value="v4.5">V4.5 입력 초안</option>
              <option value="v5">V5 입력 초안</option>
            </select>
          </label>
          <label htmlFor="pw-field-7" className="pw-field">
            화면 비율
            <select
              id="pw-field-7"
              aria-label="화면 비율"
              value={draft.resolution}
              onChange={(event) =>
                updateDraft({
                  resolution: event.target
                    .value as WorkspaceDraft['resolution'],
                })
              }
            >
              <option value="portrait">세로 · 832 × 1216</option>
              <option value="landscape">가로 · 1216 × 832</option>
              <option value="square">정사각형 · 1024 × 1024</option>
            </select>
          </label>
          <div className="pw-number-fields">
            <label htmlFor="pw-field-8" className="pw-field">
              스텝
              <input
                id="pw-field-8"
                aria-label="스텝"
                type="number"
                min="1"
                value={draft.steps}
                onChange={(event) => updateDraft({ steps: event.target.value })}
              />
            </label>
            <label htmlFor="pw-field-9" className="pw-field">
              가이던스
              <input
                id="pw-field-9"
                aria-label="가이던스"
                type="number"
                min="0"
                step="0.1"
                value={draft.guidance}
                onChange={(event) =>
                  updateDraft({ guidance: event.target.value })
                }
              />
            </label>
          </div>
          <label htmlFor="pw-field-10" className="pw-field">
            시드
            <input
              id="pw-field-10"
              aria-label="시드"
              type="number"
              min="0"
              max="4294967295"
              value={draft.seed}
              onChange={(event) => updateDraft({ seed: event.target.value })}
            />
          </label>
          <div className="pw-unconfirmed">
            <span>샘플러 / 노이즈 스케줄</span>
            <strong>실제 연동 전에 결정</strong>
          </div>
          <div className="pw-legacy-summary">
            <span className="pw-small-label">기존 V3 프로젝트 · 읽기 전용</span>
            <strong>{legacyName || '프로젝트 준비 중'}</strong>
            <span>씬 {legacySceneCount}개</span>
            <button type="button" onClick={onOpenLegacy}>
              기존 화면에서 편집 ↗
            </button>
          </div>
          <details className="pw-review-options">
            <summary>화면 상태 확인</summary>
            <label htmlFor="pw-field-11" className="pw-field">
              예제 응답
              <select
                id="pw-field-11"
                aria-label="예제 응답"
                value={state.scenario}
                onChange={(event) =>
                  setState((previous) => ({
                    ...previous,
                    scenario: event.target.value as PreviewScenario,
                  }))
                }
              >
                <option value="success">정상 예제</option>
                <option value="prompt-length">입력 길이 초과 예시</option>
                <option value="connection">연결 오류 예시</option>
              </select>
            </label>
            <p>실제 서버에 요청하지 않고 오류 표시를 확인합니다.</p>
          </details>
        </aside>
      </main>
      <footer className="pw-footer">
        <div className="pw-footer-status" aria-live="polite">
          <span className="pw-status-dot" aria-hidden="true" />
          <div>
            <strong>
              {busy ? '예제를 준비하고 있습니다' : '초안을 자유롭게 편집하세요'}
            </strong>
            <span>실제 생성·저장 없음 · 창을 닫으면 초안이 사라집니다</span>
          </div>
        </div>
        <button
          type="button"
          className="pw-generate"
          data-testid="generate-preview"
          disabled={busy}
          onClick={generate}
        >
          <span aria-hidden="true">✦</span>{' '}
          {busy ? '예제 준비 중' : '예제 만들기'}
        </button>
      </footer>
      {error && (
        <div className="pw-error" role="alert" data-testid="preview-error">
          <strong>예제를 만들지 못했습니다</strong>
          <p>{error}</p>
          <button
            type="button"
            aria-label="오류 닫기"
            onClick={() => setError('')}
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}

import { Dispatch, SetStateAction } from 'react';
import {
  WorkspaceState,
  WorkspaceDraft,
  PreviewScenario,
} from '../preview/workspaceDraft';

interface Props {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  updateDraft: (patch: Partial<WorkspaceDraft>) => void;
  legacyName: string;
  legacySceneCount: number;
  onOpenLegacy: () => void;
}
export default function WorkspaceSettings({
  state,
  setState,
  updateDraft,
  legacyName,
  legacySceneCount,
  onOpenLegacy,
}: Props) {
  const { draft } = state;
  return (
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
              resolution: event.target.value as WorkspaceDraft['resolution'],
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
            onChange={(event) => updateDraft({ guidance: event.target.value })}
          />
        </label>
      </div>
      <label htmlFor="pw-seed-mode" className="pw-field">
        시드 방식
        <select
          id="pw-seed-mode"
          aria-label="시드 방식"
          value={draft.seedMode}
          onChange={(event) =>
            updateDraft({
              seedMode: event.target.value as WorkspaceDraft['seedMode'],
            })
          }
        >
          <option value="random">매번 무작위</option>
          <option value="fixed">고정</option>
        </select>
      </label>
      <label htmlFor="pw-field-10" className="pw-field">
        시드
        <input
          id="pw-field-10"
          aria-label="시드"
          disabled={draft.seedMode === 'random'}
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
  );
}

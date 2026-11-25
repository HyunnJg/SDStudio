/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState, useEffect } from 'react';
import type { GenerationQueueState } from '../../workspaceGeneration';
import type { WorkspaceScene } from '../preview/workspaceDraft';

interface Props {
  scenes: WorkspaceScene[];
  selected: string[];
  repeats: string;
  queue: GenerationQueueState | undefined;
  disabled: boolean;
  canPrepare: boolean;
  running: boolean;
  canResume: boolean;
  onSelection: (ids: string[]) => void;
  onRepeats: (value: string) => void;
  onPrepare: () => void;
  onResume: () => void;
  onStop: () => void;
  hasResult: (id: string) => boolean;
  onResult: (id: string) => void;
  onClear: () => void;
  conflict: { sceneId: string; name: string; count: number } | undefined;
  onExclude: () => void;
}
const labels = {
  pending: '미전송',
  preparing: '준비 중',
  running: '생성 중',
  done: '✓',
  failed: '실패',
  'result-pending': '결과 저장 필요',
  skipped: '제외',
};
export default function ConnectedQueueControls({
  scenes,
  selected,
  repeats,
  queue,
  disabled,
  canPrepare,
  running,
  canResume,
  onSelection,
  onRepeats,
  onPrepare,
  onResume,
  onStop,
  hasResult,
  onResult,
  onClear,
  conflict,
  onExclude,
}: Props) {
  const [excludeConfirmed, setExcludeConfirmed] = useState(false);
  useEffect(
    () => setExcludeConfirmed(false),
    [queue?.id, conflict?.sceneId, conflict?.count],
  );
  const completed =
    queue?.items.filter((item) => item.status === 'done').length ?? 0;
  let status = queue?.stopped ? '중지' : '준비';
  if (running) status = '실행 중';
  return (
    <section
      className="connected-queue"
      aria-label="선택 씬·실제 대기열"
      data-testid="connected-queue"
    >
      <div className="connected-queue-summary">
        <strong>반복 생성</strong>
        <span data-testid="live-queue-progress">
          {completed} / {queue?.items.length ?? 0} · {status}
        </span>
        {running && (
          <button type="button" data-testid="stop-live-queue" onClick={onStop}>
            중지
          </button>
        )}
        {queue?.items.some(
          (item) => item.status === 'pending' || item.status === 'failed',
        ) && (
          <button
            type="button"
            data-testid="clear-live-queue"
            disabled={disabled}
            onClick={onClear}
          >
            남은 예약 비우기
          </button>
        )}
      </div>
      {conflict && (
        <div
          role="group"
          aria-label="충돌 씬의 미전송 예약 제외"
          data-testid="queue-conflict"
        >
          <p>
            “{conflict.name}”의 미전송 {conflict.count}건만 제외합니다. 이미
            전송한 작업·저장 PNG·현재 입력은 유지됩니다.
          </p>
          <label>
            <input
              type="checkbox"
              data-testid="exclude-conflict-confirm"
              checked={excludeConfirmed}
              disabled={disabled}
              onChange={(event) => setExcludeConfirmed(event.target.checked)}
            />
            해당 씬의 미전송 작업만 제외하겠습니다.
          </label>
          <button
            type="button"
            data-testid="exclude-conflict-scene"
            disabled={disabled || !excludeConfirmed}
            onClick={onExclude}
          >
            미전송 {conflict.count}건 제외 (전송 없음)
          </button>
        </div>
      )}
      <div id="live-queue-details">
        <fieldset disabled={disabled}>
          <legend>예약할 씬</legend>
          <div className="connected-queue-selection">
            {scenes.map((scene) => (
              <label key={scene.id}>
                <input
                  type="checkbox"
                  data-queue-scene={scene.id}
                  checked={selected.includes(scene.id)}
                  onChange={(event) =>
                    onSelection(
                      event.target.checked
                        ? [...selected, scene.id]
                        : selected.filter((id) => id !== scene.id),
                    )
                  }
                />
                {scene.name}
              </label>
            ))}
          </div>
          <label htmlFor="live-repeats">
            선택 씬마다 반복
            <input
              id="live-repeats"
              type="number"
              min="1"
              max="60"
              value={repeats}
              onChange={(event) => onRepeats(event.target.value)}
            />
          </label>

          <button
            type="button"
            data-testid="prepare-live-queue"
            disabled={!canPrepare || !selected.length}
            onClick={onPrepare}
          >
            선택한 씬 반복 생성
          </button>
          <button
            type="button"
            data-testid="resume-live-queue"
            disabled={!canResume || !canPrepare}
            onClick={onResume}
          >
            남은 작업 계속
          </button>
        </fieldset>
        {queue && (
          <ol className="connected-queue-items">
            {queue.items.map((item) => (
              <li key={item.id} data-queue-status={item.status}>
                <span>
                  {item.sceneName} · {item.repeat}회 · 시드 {item.seed} ·{' '}
                  {labels[item.status]}
                </span>
                {item.imageId && hasResult(item.imageId) && (
                  <button type="button" onClick={() => onResult(item.imageId!)}>
                    결과 열기
                  </button>
                )}
                {item.error?.mayHaveReachedServer && (
                  <span>서버 처리·사용량 소모 가능</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

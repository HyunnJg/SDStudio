import { Dispatch, SetStateAction, useState, useEffect } from 'react';
import {
  WorkspaceState,
  selectWorkspaceScene,
  snapshotWorkspaceScenes,
} from '../preview/workspaceDraft';
import { QueueSnapshot, WorkspaceQueue } from '../preview/workspaceQueue';

interface Props {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  queue: WorkspaceQueue;
  queueState: QueueSnapshot;
  disabled: boolean;
  onSelect: () => void;
  onError: (error: unknown) => void;
}
const labels = {
  pending: '대기',
  running: '진행',
  done: '완료',
  failed: '실패',
};
export default function WorkspaceScenes({
  state,
  setState,
  queue,
  queueState,
  disabled,
  onSelect,
  onError,
}: Props) {
  const [repeats, setRepeats] = useState('2');
  const [expanded, setExpanded] = useState(false);
  const { jobs, running, active } = queueState;
  const completed = jobs.filter((job) => job.status === 'done').length;
  const pending = jobs.some((job) => job.status === 'pending');
  useEffect(() => {
    if (!pending && !active && !running) setExpanded(false);
  }, [pending, active, running]);
  let status = pending ? '대기 / 중지' : '준비';
  if (running) status = '진행 중';
  if (active && !running) status = '현재 예제 완료 후 중지';
  return (
    <section
      className={`pw-scene-queue ${expanded ? '' : 'pw-queue-collapsed'}`}
      aria-label="씬·예제 대기열"
    >
      <div className="pw-scenes" role="group" aria-label="예제 씬 선택">
        <strong>예제 씬</strong>
        {state.scenes.map((scene) => (
          <button
            type="button"
            key={scene.id}
            aria-pressed={scene.id === state.selectedSceneId}
            onClick={() => {
              setState((previous) => selectWorkspaceScene(previous, scene.id));
              onSelect();
            }}
          >
            {scene.name}
          </button>
        ))}
        <span className="pw-scene-note">V3와 분리 · 메모리 보관</span>
        <span aria-live="polite" data-testid="queue-progress">
          {completed} / {jobs.length} 완료 · {status}
        </span>
        {!expanded && running && (
          <button type="button" data-testid="stop-queue" onClick={queue.stop}>
            중지
          </button>
        )}
        <button
          type="button"
          data-testid="toggle-queue"
          aria-expanded={expanded}
          aria-controls="pw-queue-details"
          onClick={() => setExpanded(!expanded)}
        >
          대기열 {expanded ? '접기' : '펼치기'}
        </button>
      </div>
      <div id="pw-queue-details" hidden={!expanded}>
        <div className="pw-queue-controls">
          <label htmlFor="pw-repeats">
            각 씬 반복{' '}
            <input
              id="pw-repeats"
              aria-label="씬 반복 횟수"
              type="number"
              min="1"
              max="10"
              value={repeats}
              onChange={(event) => setRepeats(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="reserve-scenes"
            disabled={disabled || active || running}
            onClick={() => {
              try {
                queue.reserve(
                  snapshotWorkspaceScenes(state),
                  Number(repeats),
                  state.scenario,
                );
                setExpanded(true);
              } catch (error) {
                onError(error);
              }
            }}
          >
            {jobs.length ? '전체 예약 교체' : '전체 씬 예약'}
          </button>
          <button
            type="button"
            data-testid="start-queue"
            disabled={disabled || active || running || !pending}
            onClick={queue.start}
          >
            {completed ? '계속' : '대기열 시작'}
          </button>
          <button
            type="button"
            data-testid="stop-queue"
            disabled={!running}
            onClick={queue.stop}
          >
            중지
          </button>
          <button
            type="button"
            onClick={queue.clear}
            disabled={active || running || !jobs.length}
          >
            비우기
          </button>
        </div>
        <ol className="pw-queue-jobs" aria-label="예약된 예제">
          {jobs.map((job) => (
            <li key={job.id} data-status={job.status}>
              <span>
                {job.scene.name} · {job.repeat}회
              </span>
              <strong>{labels[job.status]}</strong>
              {job.request && <small>시드 {job.request.parameters.seed}</small>}
              {job.resultId !== undefined && (
                <button
                  type="button"
                  disabled={
                    !state.results.some((result) => result.id === job.resultId)
                  }
                  title="최근 120개 결과 보관"
                  aria-label={`${job.scene.name} ${job.repeat}회 결과 열기`}
                  onClick={() =>
                    setState((previous) => ({
                      ...previous,
                      selectedResult: job.resultId!,
                    }))
                  }
                >
                  결과 열기
                </button>
              )}
            </li>
          ))}
          {!jobs.length && (
            <li>
              씬별 입력을 편집하고 전체 씬을 예약하세요. 예약 이후 편집은 이미
              예약한 입력을 바꾸지 않습니다.
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ProjectController,
  projectErrorMessage,
} from '../projects/projectController';
import './WorkspaceProjectControls.css';

interface Props {
  controller: ProjectController;
  locked: boolean;
  mode: 'bar' | 'dialogs';
}
export default function WorkspaceProjectControls({
  controller,
  locked,
  mode,
}: Props) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const panel = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (state.panel && !panel.current?.open) panel.current?.showModal();
    if (!state.panel && panel.current?.open) panel.current.close();
  }, [state.panel]);
  useEffect(() => {
    if (state.confirm && !confirm.current?.open) confirm.current?.showModal();
    if (!state.confirm && confirm.current?.open) confirm.current.close();
  }, [state.confirm]);
  const unavailable = !controller.available();
  return (
    <>
      {mode !== 'dialogs' && (
        <section
          className="workspace-project-controls"
          aria-label="작업실 프로젝트"
          data-testid="project-controls"
        >
          <label htmlFor="workspace-project-name">
            프로젝트{' '}
            <input
              id="workspace-project-name"
              aria-label="프로젝트 이름"
              value={state.name}
              maxLength={120}
              onChange={(e) => controller.setName(e.target.value)}
              disabled={locked || unavailable}
            />
          </label>
          <strong data-testid="project-dirty">
            {controller.dirty() && '미저장 변경'}
            {!controller.dirty() && state.id && '저장됨'}
            {!controller.dirty() && !state.id && '새 입력'}
          </strong>
          <button
            type="button"
            data-testid="project-save"
            onClick={() => {
              controller.save();
            }}
            disabled={locked || unavailable}
          >
            저장
          </button>
          <button
            type="button"
            data-testid="project-list"
            onClick={() => {
              controller.list();
            }}
            disabled={locked || unavailable}
          >
            열기·복구
          </button>
          <button
            type="button"
            data-testid="project-new"
            onClick={() => {
              controller.newProject();
            }}
            disabled={locked}
          >
            새 입력
          </button>
          <button
            type="button"
            data-testid="project-copy"
            onClick={() => {
              controller.copy();
            }}
            disabled={locked || unavailable}
          >
            새 복사본으로 계속
          </button>
          <button
            type="button"
            data-testid="project-input-copy"
            onClick={() => {
              controller.copy(true);
            }}
            disabled={locked || unavailable}
          >
            입력만 새로 저장
          </button>
          <p role={state.error ? 'alert' : 'status'}>
            {unavailable
              ? '프로젝트 저장은 Electron 데스크톱에서 사용할 수 있습니다.'
              : state.operation || state.message}
          </p>
          {state.images > 0 && (
            <small>
              원본 PNG {state.images}장 보관 · 이 화면의 PNG 표시/생성 연결은
              후속입니다.
            </small>
          )}
        </section>
      )}
      {mode !== 'bar' && (
        <>
          <dialog
            className="workspace-project-dialog"
            ref={panel}
            aria-label="프로젝트 열기와 복구"
            data-testid="project-dialog"
            onCancel={(e) => {
              e.preventDefault();
              controller.closePanel();
            }}
          >
            <h2>프로젝트 열기·복구</h2>
            <p>
              정보 목록만 읽었습니다. 열기·복사·복구 때 이미지 전체를
              검사합니다. 현재 예제 결과와 대기열은 임시입니다.
            </p>
            <button
              type="button"
              onClick={() => {
                controller.list();
              }}
              disabled={!!state.operation}
            >
              목록 새로 확인
            </button>
            <div className="project-list">
              {state.projects.map((p) => (
                <article key={p.id}>
                  <strong>{p.name ?? `프로젝트 ${p.id.slice(0, 8)}`}</strong>
                  {p.error && <p>{projectErrorMessage(p.error)}</p>}
                  <button
                    type="button"
                    data-project-open={p.id}
                    onClick={() => {
                      controller.open(p.id);
                    }}
                    disabled={!!state.operation}
                  >
                    열기
                  </button>
                  <button
                    type="button"
                    data-project-history={p.id}
                    onClick={() => {
                      controller.inspect(p.id);
                    }}
                    disabled={!!state.operation}
                  >
                    이력 확인
                  </button>
                </article>
              ))}
            </div>
            {state.target && (
              <section aria-label="복구 이력">
                <h3>선택한 프로젝트 이력</h3>
                <p>
                  원본을 덮어쓰지 않고 새 복사본을 만듭니다. 이미지가 분실됐으면
                  이력만으로 복구되지 않습니다.
                </p>
                {state.history.length === 0 ? (
                  <p>보관된 이전 이력이 없습니다.</p>
                ) : (
                  state.history.map((hash) => (
                    <button
                      type="button"
                      key={hash}
                      data-project-recover={hash}
                      onClick={() => {
                        controller.recover(state.target, hash);
                      }}
                      disabled={!!state.operation}
                    >
                      {hash.slice(0, 12)} 복사 복구
                    </button>
                  ))
                )}
              </section>
            )}
            <p role="status">{state.operation || state.message}</p>
            <button
              type="button"
              data-testid="project-dialog-close"
              onClick={() => controller.closePanel()}
              disabled={!!state.operation}
            >
              닫기
            </button>
          </dialog>
          <dialog
            className="workspace-project-dialog"
            ref={confirm}
            aria-label="미저장 변경 확인"
            data-testid="project-confirm"
            onCancel={(e) => {
              e.preventDefault();
              controller.confirm('cancel');
            }}
          >
            <h2>미저장 변경이 있습니다</h2>
            <p>
              {state.confirm} 전에 입력·씬을 저장할 수 있습니다. 예제 결과와
              대기열은 저장하지 않습니다.
            </p>
            <p role="status">{state.operation || state.message}</p>
            <button
              type="button"
              data-testid="project-confirm-save"
              onClick={() => {
                controller.confirm('save');
              }}
              disabled={!!state.operation}
            >
              저장하고 계속
            </button>
            <button
              type="button"
              data-testid="project-confirm-discard"
              onClick={() => {
                controller.confirm('discard');
              }}
              disabled={!!state.operation}
            >
              저장하지 않고 계속
            </button>
            <button
              type="button"
              data-testid="project-confirm-cancel"
              onClick={() => {
                controller.confirm('cancel');
              }}
              disabled={!!state.operation}
            >
              취소
            </button>
          </dialog>
        </>
      )}
    </>
  );
}

/* eslint react/require-default-props: ["error", {"functions": "defaultArguments"}] */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ProjectController,
  projectErrorMessage,
} from '../projects/projectController';
import { isProjectCapacityCode } from '../../workspaceProject';
import './WorkspaceProjectControls.css';

interface Props {
  controller: ProjectController;
  locked: boolean;
  mode: 'bar' | 'dialogs';
  connected?: boolean;
}
export default function WorkspaceProjectControls({
  controller,
  locked,
  mode,
  connected = false,
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
  const extraActions = (
    <>
      <button
        type="button"
        data-testid="project-copy"
        onClick={() => {
          controller.copy();
        }}
        disabled={locked || unavailable}
      >
        다른 이름으로 저장
      </button>
      <button
        type="button"
        data-testid="project-input-copy"
        onClick={() => {
          controller.copy(true);
        }}
        disabled={locked || unavailable}
      >
        입력만 복제
      </button>
    </>
  );
  return (
    <>
      {mode !== 'dialogs' && (
        <section
          className="workspace-project-controls"
          aria-label="작업실 프로젝트"
          data-testid="project-controls"
        >
          <button
            type="button"
            data-testid="project-new"
            onClick={() => {
              controller.newProject();
            }}
            disabled={locked}
          >
            새 프로젝트
          </button>
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
            {!controller.dirty() &&
              state.id &&
              !state.operation &&
              !state.error && (
                <span aria-label="저장됨" title="저장됨">
                  ✓
                </span>
              )}
            {state.operation && (
              <span aria-label="저장 중" className="workspace-working">
                ◌
              </span>
            )}
            {state.error && '확인 필요'}
            {!controller.dirty() && !state.id && '새 프로젝트'}
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
            열기
          </button>
          {connected ? (
            <details className="connected-menu connected-project-menu">
              <summary>더 보기</summary>
              <div>{extraActions}</div>
            </details>
          ) : (
            extraActions
          )}
          {state.lastTrashedProject && (
            <button
              type="button"
              data-testid="undo-project-trash"
              disabled={locked || unavailable}
              onClick={() =>
                controller.restoreProject(state.lastTrashedProject!.id, true)
              }
            >
              프로젝트 복원
            </button>
          )}
          {state.error === 'PROJECT_SERVICE_STOPPED' && (
            <button
              type="button"
              data-testid="restart-project-storage"
              onClick={() => {
                controller.restartStorage();
              }}
              disabled={!!state.operation || unavailable}
            >
              저장 기능 다시 시작
            </button>
          )}
          {state.id && isProjectCapacityCode(state.error) && (
            <button
              type="button"
              disabled={locked || unavailable}
              onClick={() => controller.copy(true)}
            >
              입력만 새 프로젝트로
            </button>
          )}
          {(!connected || state.error) && (
            <p role={state.error ? 'alert' : 'status'}>
              {unavailable && '데스크톱에서 사용할 수 있습니다.'}
              {!unavailable && state.error && projectErrorMessage(state.error)}
              {!unavailable && !state.error && state.operation}
            </p>
          )}
          {!connected && state.images > 0 && (
            <small>
              원본 PNG {state.images}장 보관 ·{' '}
              {connected
                ? '결과 영역에서 저장된 PNG를 열 수 있습니다.'
                : '이 화면의 PNG 표시/생성 연결은 후속입니다.'}
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
            <h2>{state.showTrash ? '프로젝트 휴지통' : '프로젝트'}</h2>
            <nav aria-label="프로젝트 목록 종류">
              <button
                type="button"
                data-testid="project-active-tab"
                aria-pressed={!state.showTrash}
                disabled={!!state.operation}
                onClick={() => controller.list(false)}
              >
                프로젝트
              </button>
              <button
                type="button"
                data-testid="project-trash-tab"
                aria-pressed={state.showTrash}
                disabled={!!state.operation}
                onClick={() => controller.list(true)}
              >
                휴지통
              </button>
            </nav>
            <button
              type="button"
              onClick={() => {
                controller.list(state.showTrash);
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
                  {state.showTrash ? (
                    <button
                      type="button"
                      data-project-restore={p.id}
                      disabled={!!state.operation}
                      onClick={() => controller.restoreProject(p.id)}
                    >
                      복원
                    </button>
                  ) : (
                    <>
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
                      <button
                        type="button"
                        data-project-trash={p.id}
                        disabled={locked || !!state.operation}
                        onClick={() => controller.trashProject(p.id)}
                      >
                        휴지통으로
                      </button>
                    </>
                  )}
                </article>
              ))}
            </div>
            {state.projects.length === 0 && (
              <p>
                {state.showTrash
                  ? '휴지통이 비었습니다.'
                  : '저장된 프로젝트가 없습니다.'}
              </p>
            )}
            {state.showTrash && (
              <small>원본 이미지와 이력은 함께 보관됩니다.</small>
            )}
            {!state.showTrash && state.target && (
              <section aria-label="복구 이력">
                <h3>선택한 프로젝트 이력</h3>
                <p>선택한 저장본을 새 프로젝트로 복구합니다.</p>
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
            {state.error && (
              <p role="alert">{projectErrorMessage(state.error)}</p>
            )}
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
            <p>{state.confirm} 전에 변경 내용을 저장할까요?</p>
            {state.error && (
              <p role="alert">{projectErrorMessage(state.error)}</p>
            )}
            {state.error === 'PROJECT_SERVICE_STOPPED' && (
              <button
                type="button"
                data-testid="restart-project-storage-confirm"
                onClick={() => {
                  controller.restartStorage();
                }}
                disabled={!!state.operation || unavailable}
              >
                저장 기능 다시 시작
              </button>
            )}
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

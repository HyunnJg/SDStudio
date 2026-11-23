/* eslint no-void: off, jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] -- Promise effects and explicit htmlFor/id controls. */
import {
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  Dispatch,
  SetStateAction,
} from 'react';
import type {
  GenerationClient,
  GenerationPlan,
  GenerationReply,
  GenerationFailure,
  GeneratedProject,
  GenerationQueuePlan,
  GenerationQueueState,
  GenerationQueueStatus,
} from '../../workspaceGeneration';
import type { ProjectClient } from '../../workspaceProject';
import { ProjectController } from '../projects/projectController';
import type { WorkspaceState, WorkspaceDraft } from '../preview/workspaceDraft';
import { selectWorkspaceScene } from '../preview/workspaceDraft';
import { runtimeOptions } from '../runtime';
import WorkspaceProjectControls from './WorkspaceProjectControls';
import ConnectedQueueControls from './ConnectedQueueControls';
import './PreviewWorkspace.css';
import './ConnectedWorkspace.css';

function unwrap<T>(reply: GenerationReply<T>): T {
  if (!reply.ok) throw reply;
  return reply.value;
}
export function generationMessage(error: unknown): string {
  const e = error as Partial<GenerationFailure>;
  const detail: Record<string, string> = {
    OFFLINE:
      '오프라인입니다. API 토큰 설정에서 연결 모드를 변경하고 재시작하세요.',
    UNSUPPORTED_DRAFT:
      '이번 연결은 V4.5 Full·512×512·28스텝·가이던스5·캐릭터 없음만 지원합니다. | 문법과 프롬프트 조각 전개는 아직 지원하지 않습니다.',
    INVALID_INPUT: '프롬프트와 고정 시드(0~4294967295)를 확인하세요.',
    TOKEN_MISSING: 'API 토큰 설정에서 Persistent API Token을 입력하세요.',
    STORE_UNREADABLE:
      '저장된 토큰을 읽지 못했습니다. API 토큰 설정에서 로컬 읽기 확인을 해주세요.',
    STORE_VERSION:
      '저장된 토큰 형식을 읽지 못했습니다. API 토큰 설정에서 복구 안내를 확인하세요.',
    CONFIRMATION_EXPIRED:
      '확인이 만료됐거나 이미 사용됐습니다. 입력 저장 후 새 설정을 확인하세요.',
    QUEUE_LIMIT: '예약 최대60건·프로젝트 이미지120장 한도를 확인하세요.',
    GENERATION_BUSY: '진행 중 요청이나 저장하지 못한 결과를 먼저 처리하세요.',
    CANCELLED: '취소했습니다.',
    TIMEOUT: '응답 기한을 넘었습니다.',
    RESULT_SAVE_FAILED:
      'PNG는 받았지만 저장 결과를 확정하지 못했습니다. 결과만 다시 저장하면 API를 재호출하지 않습니다.',
    PROJECT_BUSY:
      '남은 저장 잠금이 있습니다. 프로젝트를 새 복사본으로 계속한 뒤 새로 확인하세요.',
    PROJECT_LIMIT:
      '프로젝트 보관 한도에 가깝습니다. 새 프로젝트에서 계속하세요.',
    PROJECT_CONFLICT:
      '프로젝트가 변경됐습니다. 다시 열어 저장 상태를 확인하세요.',
  };
  let text =
    detail[e.code ?? ''] ??
    '요청 또는 결과를 처리하지 못했습니다. 입력은 유지되며 자동 재시도하지 않습니다.';
  if (e.httpStatus === 401)
    text = '토큰 인증이 거부됐습니다. API 토큰 설정을 확인하세요.';
  if (e.httpStatus === 402)
    text = '계정의 잔액·사용 조건을 NovelAI 웹에서 확인하세요.';
  if (e.httpStatus === 429)
    text = '요청 한도에 도달했습니다. 자동 재시도하지 않습니다.';
  if (e.mayHaveReachedServer)
    text += ' 서버가 이미 처리했거나 사용량이 소모됐을 수 있습니다.';
  return text;
}
interface Props {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  project: ProjectController;
  projectLocked: boolean;
  darkMode: boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenAuth: () => void;
  onOpenLegacy: () => void;
  onToggleTheme: () => void;
}
export default function ConnectedWorkspace({
  state,
  setState,
  project,
  projectLocked,
  darkMode,
  onBusyChange,
  onOpenAuth,
  onOpenLegacy,
  onToggleTheme,
}: Props) {
  const client: GenerationClient = window.electron.generation;
  const { projects }: { projects: ProjectClient } = window.electron;
  const view = useSyncExternalStore(project.subscribe, project.getSnapshot);
  const operation = useRef(false);
  const [phase, setPhase] = useState('');
  const [plan, setPlan] = useState<GenerationPlan>();
  const [queuePlan, setQueuePlan] = useState<GenerationQueuePlan>();
  const [queue, setQueue] = useState<GenerationQueueState>();
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [repeats, setRepeats] = useState('2');
  const revisionRef = useRef(view.revision);
  revisionRef.current = view.revision;
  const [confirmed, setConfirmed] = useState(false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [storageStopped, setStorageStopped] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const images = view.imageRecords;
  const [selected, setSelected] = useState('');
  const [imageURL, setImageURL] = useState('');
  const busy = !!phase || pending || active;
  const locked = busy || projectLocked;
  useEffect(() => {
    setSceneIds([]);
  }, [view.id]);
  useEffect(() => setDiscardConfirmed(false), [pending]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    let alive = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const status = unwrap(await client.status());
        const knownRevision = revisionRef.current;
        const queued = unwrap(await client.queueStatus(knownRevision));
        if (alive) {
          setQueue(queued.queue);
          const current = project.getSnapshot();
          if (
            queued.latest &&
            current.id === queued.latest.snapshot.project.id &&
            current.revision === knownRevision
          ) {
            project.acceptGenerated(queued.latest.snapshot);
            setSelected(queued.latest.imageId);
          }
        }
        if (alive) {
          setPending(status.pending);
          setActive(status.active);
        }
      } catch {
        if (alive)
          setMessage(
            '생성 상태를 확인하지 못했습니다. 요청을 다시 보내지 말고 앱 상태를 확인하세요.',
          );
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, project]);
  useEffect(() => {
    setSelected((previous) =>
      images.some((image) => image.id === previous)
        ? previous
        : (images.at(-1)?.id ?? ''),
    );
  }, [images]);
  useEffect(() => {
    let alive = true;
    let url = '';
    setImageURL('');
    if (view.id && selected)
      void client
        .image(view.id, selected)
        .then((reply) => {
          if (!alive) return undefined;
          const bytes = unwrap(reply);
          url = URL.createObjectURL(
            new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
          );
          setImageURL(url);
          return undefined;
        })
        .catch((error) => {
          if (alive) setMessage(generationMessage(error));
        });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, view.id, selected]);
  const patch = (value: Partial<WorkspaceDraft>) => {
    setPlan(undefined);
    setQueuePlan(undefined);
    setState((previous) => ({
      ...previous,
      draft: { ...previous.draft, ...value },
    }));
  };
  const prepare = async () => {
    if (operation.current) return;
    operation.current = true;
    setMessage('');
    setPhase('save');
    try {
      if (!(await project.save())) return;
      const saved = project.getSnapshot();
      const prepared = unwrap(
        await client.prepare(saved.id!, saved.revision!, state.selectedSceneId),
      );
      setPlan(prepared);
      setConfirmed(false);
      setPhase('confirm');
    } catch (error) {
      setMessage(generationMessage(error));
    } finally {
      operation.current = false;
      setPhase((previous) => (previous === 'confirm' ? previous : ''));
    }
  };
  const accept = (value: GeneratedProject, asNewProject = false) => {
    project.acceptGenerated(value.snapshot, asNewProject);
    setSelected(value.imageId);
    setPending(false);
    setMessage('PNG 원본과 실제 사용 시드를 프로젝트에 저장했습니다.');
  };
  const run = async (saveOnly = false, asNewProject = false) => {
    if (operation.current) return;
    operation.current = true;
    setPhase('run');
    setPlan(undefined);
    setMessage('');
    try {
      accept(
        unwrap(
          await (saveOnly
            ? client.retrySave(asNewProject)
            : client.run(plan!.ticket, confirmed)),
        ),
        asNewProject,
      );
    } catch (error) {
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
      setMessage(generationMessage(error));
      setPending(!!(error as GenerationFailure).pendingResult);
    } finally {
      operation.current = false;
      setPhase('');
    }
  };
  const cancel = async () => {
    try {
      unwrap(await client.cancel());
      setPlan(undefined);
      setQueuePlan(undefined);
      setConfirmed(false);
      if (phase === 'confirm') setPhase('');
    } catch (error) {
      setMessage(generationMessage(error));
    }
  };
  const acceptQueue = (value: GenerationQueueStatus) => {
    setQueue(value.queue);
    if (
      value.latest &&
      value.latest.snapshot.project.id === project.getSnapshot().id
    ) {
      project.acceptGenerated(value.latest.snapshot);
      setSelected(value.latest.imageId);
    }
    const error = value.queue?.items.find((item) => item.error)?.error;
    if (error) {
      setMessage(generationMessage(error));
      setPending(!!error.pendingResult);
      setStorageStopped(error.projectCode === 'PROJECT_SERVICE_STOPPED');
    } else
      setMessage(
        value.queue?.stopped
          ? '중지했습니다. 미전송 작업은 새 확인 후에만 계속합니다.'
          : '예약 결과를 PNG 원본과 함께 저장했습니다.',
      );
  };
  const prepareQueue = async (remaining = false) => {
    if (operation.current) return;
    operation.current = true;
    setPhase('save');
    setMessage('');
    setPlan(undefined);
    setQueuePlan(undefined);
    try {
      if (!(await project.save())) return;
      const saved = project.getSnapshot();
      const prepared = unwrap(
        await (remaining
          ? client.prepareRemaining(queue!.id, saved.id!, saved.revision!)
          : client.prepareQueue(
              saved.id!,
              saved.revision!,
              sceneIds,
              Number(repeats),
            )),
      );
      setQueuePlan(prepared);
      setConfirmed(false);
      setPhase('confirm');
    } catch (error) {
      setMessage(generationMessage(error));
    } finally {
      operation.current = false;
      setPhase((previous) => (previous === 'confirm' ? previous : ''));
    }
  };
  const runQueue = async () => {
    if (operation.current) return;
    operation.current = true;
    setPhase('queue-run');
    setMessage('');
    const { ticket } = queuePlan!;
    setQueuePlan(undefined);
    try {
      acceptQueue(unwrap(await client.runQueue(ticket, confirmed)));
    } catch (error) {
      setMessage(generationMessage(error));
    } finally {
      operation.current = false;
      setPhase('');
    }
  };
  const result = images.find((i) => i.id === selected);
  return (
    <div
      className={`preview-workspace connected-workspace ${darkMode ? '' : 'pw-light'}`}
      data-testid="connected-workspace"
    >
      <header className="pw-header">
        <div className="pw-brand">
          <strong>SDStudio</strong>
          <span>V4.5 Full · 씬·대기열</span>
        </div>
        <nav>
          <button type="button" onClick={onOpenAuth}>
            API 토큰·연결 모드
          </button>
          <button type="button" onClick={onToggleTheme}>
            테마 전환
          </button>
          <button
            type="button"
            onClick={onOpenLegacy}
            disabled={locked}
            data-testid="open-legacy"
          >
            기존 V3 화면
          </button>
        </nav>
        <span>
          {runtimeOptions.offline
            ? '오프라인 · 생성 차단'
            : '온라인 · 생성 연결'}
        </span>
      </header>
      <WorkspaceProjectControls
        controller={project}
        locked={locked}
        mode="bar"
        connected
      />
      <main className="connected-body">
        <section className="connected-input">
          <h2>현재 씬</h2>
          <fieldset disabled={locked}>
            <label htmlFor="live-scene">씬 선택</label>
            <select
              id="live-scene"
              value={state.selectedSceneId}
              onChange={(e) =>
                setState((previous) =>
                  selectWorkspaceScene(previous, e.target.value),
                )
              }
            >
              {state.scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
            <label htmlFor="live-prompt">프롬프트</label>
            <textarea
              id="live-prompt"
              data-testid="live-prompt"
              rows={7}
              value={state.draft.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
            <label htmlFor="live-negative">부정 프롬프트</label>
            <textarea
              id="live-negative"
              rows={3}
              value={state.draft.negativePrompt}
              onChange={(e) => patch({ negativePrompt: e.target.value })}
            />
            <label htmlFor="live-seed-mode">시드 방식</label>
            <select
              id="live-seed-mode"
              value={state.draft.seedMode}
              onChange={(e) =>
                patch({ seedMode: e.target.value as 'random' | 'fixed' })
              }
            >
              <option value="random">매번 무작위</option>
              <option value="fixed">고정</option>
            </select>
            <label htmlFor="live-seed">고정 시드</label>
            <input
              id="live-seed"
              disabled={state.draft.seedMode !== 'fixed'}
              value={state.draft.seed}
              onChange={(e) => patch({ seed: e.target.value })}
            />
            <p>512×512 · 28스텝 · 가이던스5 · Euler ancestral / Karras · 1장</p>
            <p>
              기본 요청 1장 실측을 바탕으로 연결한 범위입니다.
              캐릭터·V5·와일드카드는 아직 연결하지 않았습니다.
            </p>
            {(state.draft.family !== 'v4.5' ||
              state.draft.characters.some((c) => c.enabled) ||
              state.draft.resolution !== 'square' ||
              state.draft.steps !== '28' ||
              state.draft.guidance !== '5') && (
              <button
                type="button"
                onClick={() =>
                  patch({
                    family: 'v4.5',
                    resolution: 'square',
                    steps: '28',
                    guidance: '5',
                    characters: state.draft.characters.map((c) => ({
                      ...c,
                      enabled: false,
                    })),
                  })
                }
              >
                현재 씬을 기본 설정으로 전환 (캐릭터 비활성)
              </button>
            )}
            <button
              type="button"
              className="pw-generate"
              data-testid="prepare-generation"
              disabled={runtimeOptions.offline}
              onClick={prepare}
            >
              입력 저장 후 1장 생성 확인
            </button>
          </fieldset>
          {plan && (
            <section
              className="connected-confirm"
              aria-label="생성 전 확인"
              data-testid="generation-confirm"
            >
              <h3>이번 요청 1회</h3>
              <p>
                {plan.model} · {plan.width}×{plan.height} · 시드 {plan.seed}
              </p>
              <p>
                앱은 비용·무료 여부·사용량을 계산하지 않습니다. Opus도 설정에
                따라 할당량/Anlas가 소모될 수 있으므로 같은 설정을 웹에서
                확인하세요.
              </p>
              <p>
                PNG 결과를 추가하면 프로젝트를 v2로 저장합니다. v1만 지원하는
                이전 앱은 열 수 없으며, 기존 입력은 저장 이력에 남습니다.
              </p>
              <label>
                <input
                  type="checkbox"
                  data-testid="generation-cost-confirm"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                NovelAI 웹에서 같은 설정의 비용·사용 조건을 확인했습니다.
              </label>
              <button
                type="button"
                data-testid="send-generation"
                disabled={!confirmed}
                onClick={() => run()}
              >
                이번 요청 1회 전송
              </button>
              <button type="button" onClick={cancel}>
                취소
              </button>
            </section>
          )}
          {queuePlan && (
            <section
              className="connected-confirm"
              aria-label="대기열 실행 전 확인"
              data-testid="queue-confirm"
            >
              <h3>
                총 {queuePlan.total}회 요청 · 이미지 {queuePlan.total}장
              </h3>
              <p>
                {queuePlan.model} · {queuePlan.width}×{queuePlan.height} ·{' '}
                {queuePlan.steps}스텝 · 가이던스 {queuePlan.scale} · Euler
                ancestral / Karras
              </p>
              <p>
                씬·반복·확정 시드는 아래 예약 목록과 같습니다. 입력·예약을
                바꾸려면 취소 후 새로 확인하세요. 확인은5분·1회용입니다.
              </p>
              <p>
                앱은 비용·무료 여부·Opus 할당량을 계산하지 않습니다. NovelAI
                웹에서 같은 설정과 총 요청 수의 사용 조건을 확인하세요. 저장
                공간이 부족하면 실행 중에도 중지될 수 있습니다. PNG 저장 시 v2로
                기록되어 v1 전용 앱에서는 열 수 없습니다.
              </p>
              <ol>
                {queuePlan.items.map((item) => (
                  <li key={item.id}>
                    {item.sceneName} · {item.repeat}회 · 시드 {item.seed}
                  </li>
                ))}
              </ol>
              <label>
                <input
                  type="checkbox"
                  data-testid="queue-cost-confirm"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                총 요청 수와 같은 설정의 웹 비용·사용 조건을 확인했습니다.
              </label>
              <button
                type="button"
                data-testid="send-live-queue"
                disabled={!confirmed}
                onClick={runQueue}
              >
                확인한 {queuePlan.total}회 실행
              </button>
              <button type="button" onClick={cancel}>
                취소·예약 변경
              </button>
            </section>
          )}
          {(phase === 'run' || phase === 'queue-run') && (
            <button
              type="button"
              data-testid="cancel-generation"
              onClick={cancel}
            >
              요청 취소 (서버 처리 여부는 불확실)
            </button>
          )}
          {pending && (
            <section role="alert">
              <p>
                저장하지 못한 결과가 메모리에 있습니다. 창을 닫으면 사라집니다.
                새 프로젝트에 보관하면 이전 미전송 예약은 종료됩니다.
              </p>
              <button
                type="button"
                data-testid="retry-result-save"
                disabled={!!phase || active}
                onClick={() => run(true)}
              >
                결과만 다시 저장 (API 재호출 없음)
              </button>
              <button
                type="button"
                data-testid="save-result-new-project"
                disabled={!!phase || active}
                onClick={() => run(true, true)}
              >
                입력·이번 결과만 새 프로젝트로 저장 (이전 PNG 제외)
              </button>
              {storageStopped && (
                <button
                  type="button"
                  disabled={!!phase || active}
                  onClick={async () => {
                    try {
                      const restarted = await projects.restartStorage();
                      if (!restarted.ok) throw restarted;
                      setStorageStopped(false);
                      setMessage(
                        '저장 기능을 다시 시작했습니다. 결과 저장은 별도로 선택하세요.',
                      );
                    } catch {
                      setMessage(
                        '저장 기능을 복구하지 못했습니다. PNG는 아직 메모리에 있습니다.',
                      );
                    }
                  }}
                >
                  저장 기능 다시 시작
                </button>
              )}
              <label htmlFor="discard-pending-result">
                <input
                  id="discard-pending-result"
                  type="checkbox"
                  checked={discardConfirmed}
                  onChange={(e) => setDiscardConfirmed(e.target.checked)}
                />
                메모리에 남은 PNG를 버리겠습니다. 사용량은 되돌릴 수 없습니다.
              </label>
              <button
                type="button"
                disabled={!!phase || active || !discardConfirmed}
                onClick={async () => {
                  try {
                    unwrap(await client.discardPending());
                    setPending(false);
                  } catch (error) {
                    setMessage(generationMessage(error));
                  }
                }}
              >
                미저장 결과 버리기
              </button>
            </section>
          )}
          <p role="status" data-testid="generation-status">
            {phase === 'run' || phase === 'queue-run'
              ? '전송·응답 검증·저장 중'
              : message}
          </p>
        </section>
        <section className="connected-results" aria-label="프로젝트 PNG 결과">
          <h2>저장된 PNG · {images.length}장</h2>
          {imageURL ? (
            <img
              className="connected-image"
              data-testid="generated-png"
              src={imageURL}
              alt="프로젝트에 저장된 NovelAI 생성 결과"
              onError={() =>
                setMessage(
                  '원본 PNG는 보관됐지만 화면에서 해석하지 못했습니다. 자동으로 다시 생성하지 않습니다.',
                )
              }
            />
          ) : (
            <div className="connected-empty">
              저장된 결과를 선택하면 원본 PNG를 표시합니다.
            </div>
          )}
          {result && (
            <p data-testid="generated-seed">
              {result.model} · 실제 사용 시드 {result.seed} ·{' '}
              {result.pngBytes.toLocaleString()} bytes
            </p>
          )}
          <div className="connected-history">
            {images.map((image, index) => (
              <button
                type="button"
                key={image.id}
                aria-pressed={image.id === selected}
                data-image-id={image.id}
                onClick={() => setSelected(image.id)}
              >
                결과 {index + 1} · 시드 {image.seed}
              </button>
            ))}
          </div>
        </section>
      </main>
      <ConnectedQueueControls
        scenes={state.scenes}
        selected={sceneIds}
        repeats={repeats}
        queue={queue?.projectId === view.id ? queue : undefined}
        disabled={locked}
        canPrepare={!runtimeOptions.offline}
        running={!!queue?.running}
        canResume={
          queue?.projectId === view.id &&
          !!queue?.items.some((item) => item.status === 'pending')
        }
        onSelection={(ids) => {
          setSceneIds(ids);
          setQueuePlan(undefined);
        }}
        onRepeats={(value) => {
          setRepeats(value);
          setQueuePlan(undefined);
        }}
        onPrepare={() => prepareQueue()}
        onResume={() => prepareQueue(true)}
        onStop={cancel}
        onClear={async () => {
          try {
            unwrap(await client.clearQueue());
            setQueue(undefined);
            setQueuePlan(undefined);
          } catch (error) {
            setMessage(generationMessage(error));
          }
        }}
        onResult={setSelected}
      />
    </div>
  );
}

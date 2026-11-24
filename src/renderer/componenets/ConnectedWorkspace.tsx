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
import ConnectedCharacters from './ConnectedCharacters';
import ConnectedImageHistory from './ConnectedImageHistory';
import {
  generationMessage,
  availableQueueSceneIds,
  queueOutcome,
  ANLAS_STEP_WARNING,
  requiresAnlasWarning,
} from '../generation/generationPresentation';
import './PreviewWorkspace.css';
import './ConnectedWorkspace.css';

function unwrap<T>(reply: GenerationReply<T>): T {
  if (!reply.ok) throw reply;
  return reply.value;
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
  const generationEpoch = useRef(0);
  const [phase, setPhase] = useState('');
  const [singlePlan, setSinglePlan] = useState<GenerationPlan>();
  const singleConfirmation = useRef<HTMLElement>(null);
  const [queuePlan, setQueuePlan] = useState<GenerationQueuePlan>();
  const [queue, setQueue] = useState<GenerationQueueState>();
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [repeats, setRepeats] = useState('2');
  const availableSceneIds = availableQueueSceneIds(sceneIds, state.scenes);
  const sceneNames = useRef<{ id: string; name: string }[]>([]);
  sceneNames.current = [
    ...state.scenes,
    ...(queue?.items.map((item) => ({
      id: item.sceneId,
      name: item.sceneName,
    })) ?? []),
  ];
  const revisionRef = useRef(view.revision);
  revisionRef.current = view.revision;
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [storageStopped, setStorageStopped] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const images = view.imageRecords;
  const [selected, setSelected] = useState('');
  const [imageURL, setImageURL] = useState('');
  const [promptTab, setPromptTab] = useState<'prompt' | 'negative'>('prompt');
  const [sidebarTab, setSidebarTab] = useState<'results' | 'queue'>('results');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'input' | 'result'>('input');
  const queueConfirmation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (queuePlan) {
      setMobilePane('result');
      setSidebarOpen(false);
      queueConfirmation.current?.scrollIntoView({ block: 'nearest' });
      queueConfirmation.current?.focus();
    }
  }, [queuePlan, mobilePane]);
  useEffect(() => {
    if (singlePlan || pending) {
      setMobilePane('result');
      setSidebarOpen(false);
    }
  }, [singlePlan, pending]);
  const busy = !!phase || pending || active;
  const locked = busy || projectLocked;
  useEffect(() => {
    if (singlePlan) {
      singleConfirmation.current?.scrollIntoView({ block: 'nearest' });
      singleConfirmation.current?.focus();
    }
  }, [singlePlan, mobilePane]);
  useEffect(() => {
    setSceneIds([]);
  }, [view.id]);
  useEffect(() => {
    setSceneIds((previous) => availableQueueSceneIds(previous, state.scenes));
  }, [state.scenes]);
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
      const epoch = generationEpoch.current;
      try {
        const status = unwrap(await client.status());
        const knownRevision = revisionRef.current;
        const queued = unwrap(await client.queueStatus(knownRevision));
        if (alive && epoch === generationEpoch.current) {
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
        if (alive && epoch === generationEpoch.current) {
          setPending(status.pending || queueOutcome(queued.queue).pending);
          setActive(status.active || !!queued.queue?.running);
        }
      } catch {
        if (alive && epoch === generationEpoch.current)
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
          if (alive) setMessage(generationMessage(error, sceneNames.current));
        });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, view.id, selected]);
  const patch = (value: Partial<WorkspaceDraft>) => {
    setSinglePlan(undefined);
    setQueuePlan(undefined);
    setState((previous) => ({
      ...previous,
      draft: { ...previous.draft, ...value },
    }));
  };
  const accept = (value: GeneratedProject, asNewProject = false) => {
    project.acceptGenerated(value.snapshot, asNewProject);
    setSelected(value.imageId);
    setMobilePane('result');
    setPending(false);
    setMessage('PNG 원본과 실제 사용 시드를 프로젝트에 저장했습니다.');
  };
  const prepare = async () => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setMessage('');
    setSinglePlan(undefined);
    setPhase('save');
    try {
      if (!(await project.save())) return;
      const saved = project.getSnapshot();
      const prepared = unwrap(
        await client.prepare(saved.id!, saved.revision!, state.selectedSceneId),
      );
      if (requiresAnlasWarning(prepared)) {
        setSinglePlan(prepared);
        setPhase('single-confirm');
        return;
      }
      setPhase('run');
      accept(unwrap(await client.run(prepared.ticket, true)));
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
      setPending(!!(error as GenerationFailure).pendingResult);
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase((previous) => (previous === 'single-confirm' ? previous : ''));
    }
  };
  const confirmHighSteps = async () => {
    if (operation.current || !singlePlan) return;
    const { ticket } = singlePlan;
    operation.current = true;
    generationEpoch.current += 1;
    setSinglePlan(undefined);
    setMessage('');
    setPhase('run');
    try {
      accept(unwrap(await client.run(ticket, true)));
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
      setPending(!!(error as GenerationFailure).pendingResult);
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const retryResult = async (asNewProject = false) => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('run');
    setMessage('');
    try {
      accept(unwrap(await client.retrySave(asNewProject)), asNewProject);
    } catch (error) {
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
      setMessage(generationMessage(error, sceneNames.current));
      setPending(!!(error as GenerationFailure).pendingResult);
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const cancel = async () => {
    try {
      unwrap(await client.cancel());
      setSinglePlan(undefined);
      setQueuePlan(undefined);
      if (phase === 'confirm' || phase === 'single-confirm') setPhase('');
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
    }
  };
  const acceptQueue = (value: GenerationQueueStatus) => {
    setActive(false);
    setQueue(value.queue);
    if (
      value.latest &&
      value.latest.snapshot.project.id === project.getSnapshot().id
    ) {
      project.acceptGenerated(value.latest.snapshot);
      setSelected(value.latest.imageId);
    }
    const outcome = queueOutcome(value.queue);
    const { error } = outcome;
    setPending(outcome.pending);
    setStorageStopped(outcome.storageStopped);
    if (error) {
      setMessage(generationMessage(error, sceneNames.current));
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
    generationEpoch.current += 1;
    setPhase('save');
    setMessage('');
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
              availableSceneIds,
              Number(repeats),
            )),
      );
      const current = unwrap(await client.queueStatus(saved.revision));
      if (current.queue?.id !== prepared.queueId)
        unwrap({
          ok: false,
          code: 'CONFIRMATION_EXPIRED',
          mayHaveReachedServer: false,
        });
      setQueue(current.queue);
      setQueuePlan(prepared);
      setPhase('confirm');
    } catch (error) {
      try {
        setQueue(unwrap(await client.queueStatus()).queue);
      } catch {
        /* Keep the preparation error if metadata refresh fails. */
      }
      setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase((previous) => (previous === 'confirm' ? previous : ''));
    }
  };
  const runQueue = async () => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('queue-run');
    setMessage('');
    const { ticket } = queuePlan!;
    setQueuePlan(undefined);
    try {
      acceptQueue(unwrap(await client.runQueue(ticket, true)));
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const currentFailure = queueOutcome(queue).error;
  const conflictSceneId =
    currentFailure?.code === 'QUEUE_INPUT_CHANGED'
      ? currentFailure.conflictSceneId
      : undefined;
  const excludedCount = conflictSceneId
    ? (queue?.items.filter(
        (item) => item.status === 'pending' && item.sceneId === conflictSceneId,
      ).length ?? 0)
    : 0;
  const conflict =
    conflictSceneId && excludedCount && queue?.projectId === view.id
      ? {
          sceneId: conflictSceneId,
          count: excludedCount,
          name:
            sceneNames.current.find((scene) => scene.id === conflictSceneId)
              ?.name ?? '예약 씬',
        }
      : undefined;
  const excludeConflict = async () => {
    if (operation.current || !conflict || !queue) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('exclude');
    try {
      const value = unwrap(
        await client.excludePendingScene(queue.id, conflict.sceneId, true),
      );
      setQueue(value.queue);
      setQueuePlan(undefined);
      setMessage(
        `“${conflict.name}”의 미전송 ${conflict.count}건을 제외했습니다. 다른 미전송 작업은 새 확인 후 실행합니다.`,
      );
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const result = images.find((i) => i.id === selected);
  const currentScene = state.scenes.find(
    (scene) => scene.id === state.selectedSceneId,
  );
  const showResult = (id: string) => {
    setSelected(id);
    setMobilePane('result');
    setSidebarOpen(false);
  };
  let generateLabel = '이미지 생성';
  if (phase === 'save') generateLabel = '입력 저장 중…';
  else if (phase === 'run' || phase === 'queue-run') generateLabel = '생성 중…';
  else if (pending) generateLabel = '결과 저장 필요';
  else if (singlePlan || queuePlan) generateLabel = '실행 확인 대기';
  return (
    <div
      className={`preview-workspace connected-workspace ${darkMode ? '' : 'pw-light'}`}
      data-testid="connected-workspace"
      data-mobile-pane={mobilePane}
    >
      <header className="pw-header">
        <div className="pw-brand">
          <strong>SDStudio</strong>
          <span>이미지 작업실</span>
        </div>
        <span className="connected-connection">
          {runtimeOptions.offline ? '오프라인' : '온라인'}
        </span>
        <nav aria-label="작업실 화면">
          <button
            type="button"
            className="connected-mobile-switch"
            onClick={() =>
              setMobilePane(mobilePane === 'input' ? 'result' : 'input')
            }
          >
            {mobilePane === 'input' ? '이미지 보기' : '입력 편집'}
          </button>
          <button
            type="button"
            className="connected-sidebar-toggle"
            aria-expanded={sidebarOpen}
            aria-controls="connected-sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            결과·씬
          </button>
          <details className="connected-menu">
            <summary>메뉴</summary>
            <div>
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
            </div>
          </details>
        </nav>
      </header>
      <WorkspaceProjectControls
        controller={project}
        locked={locked}
        mode="bar"
        connected
      />
      <main className="connected-body">
        <section className="connected-input" aria-label="생성 입력">
          <div className="connected-input-scroll" data-testid="input-scroll">
            <fieldset disabled={locked}>
              <div className="connected-model-settings">
                <label htmlFor="live-model">모델</label>
                <select
                  id="live-model"
                  value={state.draft.family}
                  onChange={(e) =>
                    patch({
                      family: e.target.value as 'v4.5' | 'v5',
                      resolution:
                        e.target.value === 'v5' ? 'portrait' : 'square',
                      steps: e.target.value === 'v5' ? '23' : '28',
                      guidance: e.target.value === 'v5' ? '7' : '5',
                      qualityTags:
                        e.target.value === 'v5' ? 'standard' : 'none',
                      ucPreset: e.target.value === 'v5' ? 'heavy' : 'none',
                    })
                  }
                >
                  <option value="v5">V5 Full</option>
                  <option value="v4.5">V4.5 Full · 기존 512px 설정</option>
                </select>
                {state.draft.family === 'v5' && (
                  <>
                    <label htmlFor="live-size">크기</label>
                    <select
                      id="live-size"
                      value={state.draft.resolution}
                      onChange={(e) =>
                        patch({
                          resolution: e.target
                            .value as WorkspaceDraft['resolution'],
                        })
                      }
                    >
                      <option value="portrait">832 × 1216 · 세로</option>
                      <option value="landscape">1216 × 832 · 가로</option>
                      <option value="square">1024 × 1024 · 정사각형</option>
                    </select>
                  </>
                )}
              </div>
              <div className="connected-editor-heading">
                <span>현재 씬</span>
                <strong>{currentScene?.name}</strong>
              </div>
              <div
                className="connected-prompt-tabs"
                role="group"
                aria-label="기본 프롬프트 선택"
              >
                <button
                  type="button"
                  aria-pressed={promptTab === 'prompt'}
                  onClick={() => setPromptTab('prompt')}
                >
                  기본 프롬프트
                </button>
                <button
                  type="button"
                  aria-pressed={promptTab === 'negative'}
                  onClick={() => setPromptTab('negative')}
                >
                  부정 프롬프트
                </button>
              </div>
              <label className="connected-sr-only" htmlFor="live-prompt">
                기본 프롬프트
              </label>
              <textarea
                id="live-prompt"
                data-testid="live-prompt"
                rows={11}
                hidden={promptTab !== 'prompt'}
                value={state.draft.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
              <label className="connected-sr-only" htmlFor="live-negative">
                부정 프롬프트
              </label>
              <textarea
                id="live-negative"
                rows={11}
                hidden={promptTab !== 'negative'}
                value={state.draft.negativePrompt}
                onChange={(e) => patch({ negativePrompt: e.target.value })}
              />
              <ConnectedCharacters
                key={`${view.id ?? 'draft'}:${state.selectedSceneId}`}
                draft={state.draft}
                onChange={patch}
              />
              <details
                className="connected-ai-settings"
                data-testid="ai-settings"
              >
                <summary>
                  <strong>AI 설정</strong>
                  <span>
                    {state.draft.steps} 스텝 · 가이던스 {state.draft.guidance} ·{' '}
                    {state.draft.seedMode === 'random'
                      ? '무작위 시드'
                      : `시드 ${state.draft.seed}`}
                  </span>
                </summary>
                <div className="connected-settings-fields">
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
                  {state.draft.family === 'v5' && (
                    <>
                      <label htmlFor="live-steps">스텝</label>
                      <input
                        id="live-steps"
                        type="number"
                        min="1"
                        max="50"
                        value={state.draft.steps}
                        onChange={(e) => patch({ steps: e.target.value })}
                      />
                      <label htmlFor="live-guidance">가이던스</label>
                      <input
                        id="live-guidance"
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={state.draft.guidance}
                        onChange={(e) => patch({ guidance: e.target.value })}
                      />
                      <label htmlFor="live-quality">품질 태그</label>
                      <select
                        id="live-quality"
                        value={state.draft.qualityTags ?? 'none'}
                        onChange={(e) =>
                          patch({
                            qualityTags: e.target
                              .value as WorkspaceDraft['qualityTags'],
                          })
                        }
                      >
                        <option value="none">추가 안 함</option>
                        <option value="light">Light</option>
                        <option value="standard">Standard</option>
                      </select>
                      <label htmlFor="live-uc-preset">
                        부정 프롬프트 프리셋
                      </label>
                      <select
                        id="live-uc-preset"
                        value={state.draft.ucPreset ?? 'none'}
                        onChange={(e) =>
                          patch({
                            ucPreset: e.target
                              .value as WorkspaceDraft['ucPreset'],
                          })
                        }
                      >
                        <option value="none">추가 안 함</option>
                        <option value="light">Light</option>
                        <option value="heavy">Heavy</option>
                        <option value="human">Human focus</option>
                        <option value="furry">Furry focus</option>
                      </select>
                      <p>
                        품질 태그는 프롬프트 뒤에, 부정 프리셋은 부정 프롬프트
                        앞에 추가합니다. 직접 같은 태그를 쓰셨다면 ‘추가 안
                        함’을 선택하세요.
                      </p>
                    </>
                  )}
                  <p>샘플러 Euler ancestral · 스케줄 Karras</p>
                </div>
              </details>
              <details className="connected-help">
                <summary>저장·사용량 안내</summary>
                <p>
                  생성 시 입력을 저장하고 1회 전송합니다. 비용·Opus 사용량은
                  NovelAI 설정에 따라 달라집니다. V5·캐릭터 결과를 저장한
                  프로젝트는 이전 앱에서 열 수 없습니다. 변경 전 저장본은 이력에
                  남습니다.
                </p>
              </details>
            </fieldset>
          </div>
        </section>
        <section className="connected-results" aria-label="프로젝트 PNG 결과">
          <header className="connected-canvas-heading">
            <span>{result ? '저장된 원본 PNG' : '미리보기'}</span>
            <small>{images.length}장 보관</small>
          </header>
          <div className="connected-feedback">
            {singlePlan && (
              <section
                ref={singleConfirmation}
                tabIndex={-1}
                className="connected-confirm"
                aria-label="높은 스텝 생성 확인"
                data-testid="high-steps-confirm"
              >
                <h3>생성 설정 확인</h3>
                <p>{ANLAS_STEP_WARNING}</p>
                <p>
                  {singlePlan.model} · {singlePlan.width}×{singlePlan.height} ·{' '}
                  {singlePlan.steps}스텝 · 가이던스 {singlePlan.scale} · 시드{' '}
                  {singlePlan.seed}
                  {!!singlePlan.characters &&
                    ` · 캐릭터 ${singlePlan.characters}명 · 자동 배치`}
                </p>
                <button
                  type="button"
                  data-testid="send-high-steps"
                  onClick={confirmHighSteps}
                >
                  Anlas 사용 가능성 확인 · 1회 생성
                </button>
                <button
                  type="button"
                  data-testid="cancel-high-steps"
                  onClick={cancel}
                >
                  취소·설정 변경
                </button>
              </section>
            )}
            {queuePlan && (
              <section
                ref={queueConfirmation}
                tabIndex={-1}
                className="connected-confirm"
                aria-label="대기열 실행 전 확인"
                data-testid="queue-confirm"
              >
                <h3>
                  총 {queuePlan.total}회 요청 · 이미지 {queuePlan.total}장
                </h3>
                {queuePlan.settings.map((settings) => (
                  <p key={JSON.stringify(settings)}>
                    {settings.model} · {settings.width}×{settings.height} ·{' '}
                    {settings.steps}스텝 · 가이던스 {settings.scale}
                    {!!settings.characters &&
                      ` · 캐릭터 ${settings.characters}명 · 자동 배치`}
                  </p>
                ))}
                {queuePlan.settings.some(requiresAnlasWarning) && (
                  <p data-testid="queue-anlas-warning">{ANLAS_STEP_WARNING}</p>
                )}
                <p>
                  아래 씬과 시드로 실행합니다. 비용·Opus 사용량은 설정에 따라
                  달라집니다. 저장 결과는 새 앱에서 읽을 수 있는 형식으로
                  보관합니다.
                </p>
                <ol>
                  {queuePlan.items.map((item) => (
                    <li key={item.id}>
                      {item.sceneName} · {item.repeat}회 · 시드 {item.seed}
                      {!!item.settings?.characters &&
                        ` · 캐릭터 ${item.settings.characters}명`}
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  data-testid="send-live-queue"
                  onClick={runQueue}
                >
                  확인한 {queuePlan.total}회 실행
                </button>
                <button type="button" onClick={cancel}>
                  취소·예약 변경
                </button>
              </section>
            )}
            {pending && (
              <section role="alert">
                <p>
                  저장하지 못한 결과가 메모리에 있습니다. 창을 닫으면
                  사라집니다. 새 프로젝트에 보관하면 이전 미전송 예약은
                  종료됩니다.
                </p>
                <button
                  type="button"
                  data-testid="retry-result-save"
                  disabled={!!phase || active}
                  onClick={() => retryResult()}
                >
                  결과만 다시 저장 (API 재호출 없음)
                </button>
                <button
                  type="button"
                  data-testid="save-result-new-project"
                  disabled={!!phase || active}
                  onClick={() => retryResult(true)}
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
                      generationEpoch.current += 1;
                      unwrap(await client.discardPending());
                      setPending(false);
                      setMessage(
                        '미저장 결과를 버렸습니다. 자동으로 다시 생성하지 않습니다.',
                      );
                    } catch (error) {
                      setMessage(generationMessage(error, sceneNames.current));
                    } finally {
                      generationEpoch.current += 1;
                    }
                  }}
                >
                  미저장 결과 버리기
                </button>
              </section>
            )}
          </div>
          <div className="connected-canvas">
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
                <strong>다음 장면을 만들어 보세요</strong>
                <span>
                  왼쪽에서 프롬프트를 쓰고 생성하세요.
                  <br />
                  저장된 이미지는 오른쪽 결과에서 다시 볼 수 있습니다.
                </span>
              </div>
            )}
          </div>
          {result && (
            <p className="connected-image-caption" data-testid="generated-seed">
              {result.model} · 실제 사용 시드 {result.seed} ·{' '}
              {result.pngBytes.toLocaleString()} bytes
            </p>
          )}
        </section>
        <aside
          id="connected-sidebar"
          className={`connected-sidebar ${sidebarOpen ? 'is-open' : ''}`}
          aria-label="결과와 씬·대기열"
        >
          <div
            className="connected-sidebar-tabs"
            role="group"
            aria-label="오른쪽 패널 선택"
          >
            <button
              type="button"
              aria-pressed={sidebarTab === 'results'}
              onClick={() => setSidebarTab('results')}
            >
              결과 {images.length}
            </button>
            <button
              type="button"
              aria-pressed={sidebarTab === 'queue'}
              onClick={() => setSidebarTab('queue')}
            >
              씬·대기열
            </button>
            <button
              type="button"
              className="connected-sidebar-toggle"
              aria-label="결과·씬 패널 닫기"
              onClick={() => setSidebarOpen(false)}
            >
              닫기
            </button>
          </div>
          <div
            className="connected-sidebar-panel"
            hidden={sidebarTab !== 'results'}
          >
            <ConnectedImageHistory
              key={view.id ?? 'draft'}
              client={client}
              projectId={view.id}
              images={images}
              selected={selected}
              selectedURL={imageURL}
              onSelect={showResult}
            />
          </div>
          <div
            className="connected-sidebar-panel"
            hidden={sidebarTab !== 'queue'}
          >
            <div className="connected-scene-select">
              <label htmlFor="live-scene">편집할 씬</label>
              <select
                id="live-scene"
                disabled={locked}
                value={state.selectedSceneId}
                onChange={(e) => {
                  setState((previous) =>
                    selectWorkspaceScene(previous, e.target.value),
                  );
                  setMobilePane('input');
                  setSidebarOpen(false);
                }}
              >
                {state.scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
                ))}
              </select>
              <p>
                씬 입력과 예약을 함께 관리합니다. 실행 준비 시 현재 입력을 먼저
                저장합니다.
              </p>
            </div>
            <ConnectedQueueControls
              scenes={state.scenes}
              selected={availableSceneIds}
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
                generationEpoch.current += 1;
                try {
                  unwrap(await client.clearQueue());
                  setQueue(undefined);
                  setQueuePlan(undefined);
                } catch (error) {
                  setMessage(generationMessage(error, sceneNames.current));
                } finally {
                  generationEpoch.current += 1;
                }
              }}
              conflict={conflict}
              onExclude={excludeConflict}
              onResult={(id) => {
                setSelected(id);
                setMobilePane('result');
                setSidebarOpen(false);
              }}
            />
          </div>
        </aside>
      </main>
      <footer className="connected-action-dock" data-testid="generation-dock">
        <p role="status" data-testid="generation-status">
          {phase === 'run' || phase === 'queue-run'
            ? '전송·응답 검증·저장 중'
            : message}
        </p>
        {(phase === 'run' || phase === 'queue-run') && (
          <button
            type="button"
            className="connected-stop"
            data-testid="cancel-generation"
            onClick={cancel}
          >
            중지 · 현재 요청 취소
          </button>
        )}
        <button
          type="button"
          className="pw-generate"
          data-testid="prepare-generation"
          disabled={locked || runtimeOptions.offline}
          onClick={prepare}
        >
          {generateLabel}
        </button>
        <small>
          {phase === 'run' || phase === 'queue-run'
            ? '취소 후에도 서버 처리·사용량 소모가 있을 수 있습니다.'
            : '현재 씬 · 1장 생성'}
        </small>
      </footer>
    </div>
  );
}

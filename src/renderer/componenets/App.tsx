import './App.css';
import { runtimeOptions } from '../runtime';
import './contexify.css';
import {
  Component,
  ReactNode,
  useEffect,
  createContext,
  useState,
  useSyncExternalStore,
  useRef,
} from 'react';
import SessionSelect from './SessionSelect';
import PreSetEditor from './PreSetEdtior';
import SceneQueuControl, { SceneCell } from './SceneQueueControl';
import TaskQueueControl from './TaskQueueControl';
import TobBar from './TobBar';
import AlertWindow from './AlertWindow';
import { DropdownSelect, TabComponent } from './UtilComponents';
import PieceEditor, { PieceCell } from './PieceEditor';
import PromptTooltip from './PromptTooltip';
import ConfirmWindow, { Dialog } from './ConfirmWindow';
import QueueControl from './SceneQueueControl';
import { FloatView, FloatViewProvider } from './FloatView';
import { observer, useObserver } from 'mobx-react-lite';
import {
  FaImages,
  FaPenFancy,
  FaPuzzlePiece,
} from 'react-icons/fa';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { usePreview } from 'react-dnd-preview';

import React from 'react';
import { CellPreview } from './ResultViewer';
import { SlotPiece } from './SceneEditor';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import ProgressWindow, { ProgressDialog } from './ProgressWindow';
import {
  taskQueueService,
  backend,
  sessionService,
  appUpdateNoticeService,
  localAIService,
  imageService,
  isMobile,
} from '../models';
import { appState } from '../models/AppService';
import { AppContextMenu } from './AppContextMenu';
import PreviewWorkspace from './PreviewWorkspace';
import WorkspaceProjectControls from './WorkspaceProjectControls';
import { finishProjectClose } from '../projects/finishProjectClose';
import { ProjectController } from '../projects/projectController';
import NaiAuthSettings from './NaiAuthSettings';
import { prepareRestart } from '../network/restartPreparation';
import {
  createWorkspaceState,
  PreviewRequest,
  previewErrorMessage,
} from '../preview/workspaceDraft';
import { WorkspaceQueue } from '../preview/workspaceQueue';
import ConnectedWorkspace from './ConnectedWorkspace';
import { createConnectedWorkspaceState } from '../generation/connectedDraft';
import { MockBackend } from '../backends/mockBackend';

import { configure } from 'mobx';
import { ExternalImageView } from './ExternalImageView';
configure({
  enforceActions: 'never',
});

interface ErrorBoundaryProps {
  children: ReactNode;
  onErr?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (this.props.onErr) {
      this.props.onErr(error, errorInfo);
    }
  }

  render() {
    return this.props.children;
  }
}

const DnDPreview = () => {
  const preview = usePreview();
  if (!preview.display) {
    return null;
  }
  const { itemType, item, style } = preview;
  style['rotate'] = '2deg';
  style['transformOrigin'] = 'center';
  let res: any = null;
  if (itemType === 'scene') {
    const { scene, curSession, getImage, cellSize } = item as any;
    res = (
      <SceneCell
        scene={scene}
        curSession={curSession}
        getImage={getImage}
        cellSize={cellSize}
        style={style}
      />
    );
  } else if (itemType === 'image') {
    const { path, cellSize, imageSize } = item as any;
    res = (
      <CellPreview
        path={path}
        cellSize={cellSize}
        imageSize={imageSize}
        style={style}
      />
    );
  } else if (itemType === 'piece') {
    res = <PieceCell {...(item as any)} style={style} />;
  } else if (itemType === 'slot') {
    res = <SlotPiece {...(item as any)} style={style} />;
  } else {
    return <></>;
  }
  return res;
};

export const App = observer(() => {
  const [authOpen, setAuthOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [legacyTool, setLegacyTool] = useState<'session' | 'inpaint' | 'pieces'>('session');
  const freshWorkspace = () => runtimeOptions.mockBackend ? createWorkspaceState() : createConnectedWorkspaceState();
  const [workspace, setWorkspace] = useState(freshWorkspace);
  const nextPreviewResult = useRef(1);
  const recordPreviewResult = (
    image: string,
    request: PreviewRequest,
    sceneName: string,
  ) => {
    const id = nextPreviewResult.current;
    nextPreviewResult.current += 1;
    setWorkspace((previous) => ({
      ...previous,
      selectedResult: id,
      results: [{ id, image, request, sceneName }, ...previous.results].slice(0, 120),
    }));
    return id;
  };
  const [workspaceQueue] = useState(() => new WorkspaceQueue({
    render: (request, scenario) => {
      if (!(backend instanceof MockBackend))
        throw new Error('Preview requires the mock backend');
      return backend.renderDraftPreview(request, scenario);
    },
    onResult: recordPreviewResult,
    onError: (error) => appState.pushMessage(previewErrorMessage(error)),
  }));
  useEffect(() => () => workspaceQueue.dispose(), [workspaceQueue]);
  useEffect(() => {
    return () => {
      taskQueueService.stop();
    };
  }, []);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const singlePreviewBusy = useRef(false);
  const [projectClosing, setProjectClosing] = useState(false);
  const projectClosingRef = useRef(false);
  const projectTasksBusy = () => {
    const queue = workspaceQueue.getSnapshot();
    return singlePreviewBusy.current || taskQueueService.hasActiveRun() || !taskQueueService.isEmpty() ||
      queue.active || queue.running || queue.jobs.some(job => job.status === 'pending' || job.status === 'running');
  };
  const [project] = useState(() => new ProjectController({
    client: window.electron?.projects,
    workspace: () => workspaceRef.current,
    busy: projectTasksBusy,
    reset: () => { const next = freshWorkspace(); workspaceRef.current = next; setWorkspace(next); workspaceQueue.clear(); },
    apply: (snapshot) => {
      const next = {...createWorkspaceState(), scenes: snapshot.project.scenes,
        selectedSceneId: snapshot.project.selectedSceneId,
        draft: snapshot.project.scenes.find(scene => scene.id === snapshot.project.selectedSceneId)!.draft,
        selectedCharacter: snapshot.project.scenes.find(scene => scene.id === snapshot.project.selectedSceneId)!.draft.characters[0]?.id ?? '',
        results: [], selectedResult: 0};
      workspaceRef.current = next; setWorkspace(next); workspaceQueue.clear();
    },
  }));
  const projectView = useSyncExternalStore(project.subscribe, project.getSnapshot);
  useEffect(() => window.electron?.projectLifecycle.onCloseRequested(() => {
    if (projectClosingRef.current) return;
    projectClosingRef.current = true; setProjectClosing(true);
    (async () => {
      try {
        if (projectTasksBusy() || project.getSnapshot().operation) { appState.pushMessage('프로젝트 저장·생성 작업 또는 프리셋 편집을 마치고 닫아 주세요. 프리셋은 라이브러리에서 저장하거나 편집을 취소할 수 있습니다.'); await window.electron.projectLifecycle.cancelClose(); return; }
        if (!(await project.prepareLeave()) || projectTasksBusy()) { await window.electron.projectLifecycle.cancelClose(); return; }
        await sessionService.saveAll();
        if (projectTasksBusy()) { await window.electron.projectLifecycle.cancelClose(); return; }
        await finishProjectClose(() => window.electron.projectLifecycle.finishClose(), message => appState.pushMessage(message));
      } catch { appState.pushMessage('저장 상태를 확인하지 못해 닫기를 중단했습니다. 입력은 유지됩니다.'); await window.electron.projectLifecycle.cancelClose(); }
      finally { projectClosingRef.current = false; setProjectClosing(false); }
    })();
  }), [project]);
  const projectContentRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    projectContentRoot.current?.toggleAttribute('inert', !!projectView.operation || projectClosing);
  }, [projectView.operation, projectClosing]);
  const previewStarted = useRef(false);
  useEffect(() => {
    if (!runtimeOptions.mockBackend || previewStarted.current) return;
    previewStarted.current = true;
    (async () => {
      await sessionService.add('오프라인 예제');
      appState.curSession = await sessionService.get('오프라인 예제');
    })().catch((error) => appState.pushMessage(error.message));
  }, []);
  const [darkMode, setDarkMode] = useState(false);
  const updatedIgnored = useRef<boolean>(false);
  useEffect(() => {
    const refreshDarkMode = async () => {
      const conf = await backend.getConfig();
      setDarkMode(!conf.whiteMode);
    };
    refreshDarkMode();
    sessionService.addEventListener('config-changed', refreshDarkMode);
    return () => {
      sessionService.removeEventListener('config-changed', refreshDarkMode);
    };
  }, []);
  useEffect(() => {
    const handleUpdate = () => {
      if (appUpdateNoticeService.outdated && !updatedIgnored.current) {
        appState.pushDialog({
          type: 'confirm',
          text: '새로운 버전이 있습니다. 새로 다운 받으시겠습니까?',
          green: true,
          callback: () => {
            backend.openWebPage(appUpdateNoticeService.releasesURL);
          },
        });
        updatedIgnored.current = true;
      }
    };
    handleUpdate();
    appUpdateNoticeService.addEventListener('updated', handleUpdate);
    return () => {
      appUpdateNoticeService.removeEventListener('updated', handleUpdate);
    };
  }, []);
  useEffect(() => {
    const removeDonwloadProgressListener = backend.onDownloadProgress(
      (progress: any) => {
        localAIService.notifyDownloadProgress(progress.percent);
      },
    );
    const removeZipProgressListener = backend.onZipProgress((progress: any) => {
      appState.setProgressDialog({
        text: '압축파일 생성 중..',
        done: progress.done,
        total: progress.total,
      });
    });
    const removeImageChangedListener = backend.onImageChanged(
      async (path: string) => {
        imageService.invalidateCache(path);
      },
    );
    const handleIPCheckFail = () => {
      appState.pushDialog({
        type: 'yes-only',
        text: '네트워크 변경을 감지하고 작업을 중단했습니다. 잦은 네트워크 변경은 계정 공유로 취급되어 밴의 위험이 있습니다. 이를 무시하고 싶으면 환경설정에서 "IP 체크 끄기"를 켜주세요.',
      });
    };
    taskQueueService.addEventListener('ip-check-fail', handleIPCheckFail);
    return () => {
      removeDonwloadProgressListener();
      removeImageChangedListener();
      removeZipProgressListener();
      taskQueueService.removeEventListener('ip-check-fail', handleIPCheckFail);
    };
  }, [appState.curSession]);

  useEffect(() => {
    const handleDragOver = (event: any) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };

    const handleDragLeave = (event: any) => {
      event.preventDefault();
    };

    const handleDrop = (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      if (previewOpen) return;
      const file = event.dataTransfer.files[0];
      if (file) {
        appState.handleFile(file);
      }
    };
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [appState.curSession, appState.dialogs, appState.messages, previewOpen]);

  useEffect(() => {
    window.curSession = appState.curSession;
    if (appState.curSession) {
      sessionService.reloadPieceLibraryDB(appState.curSession);
      imageService.refreshBatch(appState.curSession);
    }
    return () => {
      window.curSession = undefined;
    };
  }, [appState.curSession]);

  const tabs = [
    {
      tool: 'session',
      label: '이미지생성',
      content: <QueueControl type="scene" showPannel />,
      emoji: <FaImages />,
    },
    {
      tool: 'inpaint',
      label: '이미지변형',
      content: <QueueControl type="inpaint" showPannel />,
      emoji: <FaPenFancy />,
    },
    {
      tool: 'pieces',
      label: '프롬프트조각',
      content: <PieceEditor />,
      emoji: <FaPuzzlePiece />,
    },
  ];
  const content = runtimeOptions.mockBackend && previewOpen ? (
    <PreviewWorkspace project={project} projectLocked={!!projectView.operation || projectClosing} onBusyChange={value => { singlePreviewBusy.current = value; }} state={workspace} setState={setWorkspace}
      queue={workspaceQueue}
      onResult={recordPreviewResult}
      darkMode={darkMode}
      onToggleTheme={async () => {
        const config = await backend.getConfig();
        await backend.setConfig({ ...config, whiteMode: darkMode });
        setDarkMode(!darkMode);
      }}
      legacyName={appState.curSession?.name ?? ''}
      legacySceneCount={appState.curSession?.scenes.size ?? 0}
      onOpenLegacy={() => setPreviewOpen(false)}
      onOpenAuth={() => setAuthOpen(true)}
      renderPreview={(request, scenario) => {
        if (!(backend instanceof MockBackend)) throw new Error('Preview requires the mock backend');
        return backend.renderDraftPreview(request, scenario);
      }} />
  ) : window.electron && previewOpen ? (
    <ConnectedWorkspace state={workspace} setState={setWorkspace} project={project}
      projectLocked={!!projectView.operation || projectClosing} darkMode={darkMode}
      onBusyChange={value => { singlePreviewBusy.current = value; }}
      onOpenLegacy={tool => { setLegacyTool(tool); setPreviewOpen(false); }} onOpenAuth={() => setAuthOpen(true)}
      onToggleTheme={async () => {
        const config = await backend.getConfig(); await backend.setConfig({ ...config, whiteMode: darkMode }); setDarkMode(!darkMode);
      }} />
  ) : (
    <DndProvider
      backend={isMobile ? TouchBackend : HTML5Backend}
      options={{
        enableTouchEvents: true,
        enableMouseEvents: false,
        delayTouchStart: 400,
      }}
    >
      <div
        className={
          'flex flex-col relative h-screen w-screen bg-white dark:bg-slate-900 ' +
          (darkMode ? 'dark' : '')
        }
      >
        <div className="z-30">
          <DnDPreview />
        </div>
        <ErrorBoundary
          onErr={(error, errorInfo) => {
            appState.pushMessage(`${error.message}`);
          }}
        >
          <FloatViewProvider>
            <AppContextMenu />
            {appState.externalImage && <FloatView onEscape={()=>{appState.closeExternalImage()}} priority={1}>
              <ExternalImageView image={appState.externalImage} onClose={()=>{appState.closeExternalImage()}}/>
              </FloatView>
            }
            <VerticalStack>
              <StackFixed>
                <TobBar onOpenAuth={window.electron ? () => setAuthOpen(true) : undefined} onOpenPreview={window.electron ? () => setPreviewOpen(true) : undefined} />
              </StackFixed>
              <StackGrow className="flex">
                {appState.curSession && (
                  <>
                    <StackGrow outerClassName="hidden md:block">
                      <PreSetEditor key={appState.curSession.name} middlePromptMode={false} />
                    </StackGrow>
                    <StackGrow>
                      <TabComponent
                        key={appState.curSession.name}
                        tabs={tabs}
                        initialTab={tabs.findIndex(tab => tab.tool === legacyTool)}
                        toggleView={
                          <PreSetEditor
                            key={appState.curSession.name + '2'}
                            middlePromptMode={false}
                          />
                        }
                      />
                    </StackGrow>
                  </>
                )}
              </StackGrow>
            </VerticalStack>
          </FloatViewProvider>
          <StackFixed>
            <div className="px-3 py-2 border-t flex gap-3 items-center line-color">
              <div className="hidden md:block flex-1">
                <SessionSelect />
              </div>
              <div className="flex flex-none gap-4 ml-auto">
                <TaskQueueControl />
              </div>
            </div>
          </StackFixed>
        </ErrorBoundary>
        <PromptTooltip />
      </div>
    </DndProvider>
  );
  return <div className={darkMode ? 'dark' : ''}>
    <div ref={projectContentRoot} style={{display: 'contents'}}>{content}</div>
    {authOpen && <NaiAuthSettings onClose={() => setAuthOpen(false)} offline={runtimeOptions.offline} client={window.electron?.naiAuth}
      networkClient={window.electron?.networkMode}
      beforeRestart={async () => {
        if (projectClosingRef.current) return 'PROJECT_NOT_READY';
        projectClosingRef.current = true; setProjectClosing(true);
        try {
          if (!(await project.prepareLeave())) return 'PROJECT_NOT_READY';
          return await prepareRestart(
        () => {
          if (singlePreviewBusy.current) return 'WORKSPACE_PENDING';
          if (taskQueueService.hasActiveRun()) return 'LEGACY_RUNNING';
          if (!taskQueueService.isEmpty()) return 'LEGACY_PENDING';
          const snapshot = workspaceQueue.getSnapshot();
          if (snapshot.active || snapshot.running || snapshot.jobs.some(
            job => job.status === 'pending' || job.status === 'running',
          )) return 'WORKSPACE_PENDING';
          return undefined;
        },
        () => sessionService.saveAll(),
      );
        } finally { projectClosingRef.current = false; setProjectClosing(false); }
      }} />}
    <WorkspaceProjectControls controller={project} locked={!!projectView.operation || projectClosing} mode="dialogs" />
    <AlertWindow />
    <ConfirmWindow />
    {appState.progressDialog && <ProgressWindow dialog={appState.progressDialog} />}
  </div>;
});

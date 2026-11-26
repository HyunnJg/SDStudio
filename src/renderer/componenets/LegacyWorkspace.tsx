import React, { Component, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { FaImages, FaPenFancy, FaPuzzlePiece } from 'react-icons/fa';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { usePreview } from 'react-dnd-preview';
import SessionSelect from './SessionSelect';
import PreSetEditor from './PreSetEdtior';
import QueueControl, { SceneCell } from './SceneQueueControl';
import TaskQueueControl from './TaskQueueControl';
import TobBar from './TobBar';
import { TabComponent } from './UtilComponents';
import PieceEditor, { PieceCell } from './PieceEditor';
import PromptTooltip from './PromptTooltip';
import { FloatView, FloatViewProvider } from './FloatView';
import { CellPreview } from './ResultViewer';
import { SlotPiece } from './SceneEditor';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import { isMobile } from '../models';
import { appState } from '../models/AppService';
import { AppContextMenu } from './AppContextMenu';
import { ExternalImageView } from './ExternalImageView';

type BoundaryProps = { children: ReactNode; onReturn: () => void };
class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    appState.pushMessage(error.message);
  }

  render() {
    const { children, onReturn } = this.props;
    const { failed } = this.state;
    if (failed)
      return (
        <p role="alert">
          구 V3 화면을 열 수 없습니다.{' '}
          {window.electron && (
            <button type="button" onClick={onReturn}>
              작업실로 돌아가기
            </button>
          )}
        </p>
      );
    return children;
  }
}
function DnDPreview() {
  const preview = usePreview();
  if (!preview.display) {
    return null;
  }
  const { itemType, item } = preview;
  const style = { ...preview.style, rotate: '2deg', transformOrigin: 'center' };
  let res: any = null;
  if (itemType === 'scene') {
    const { scene, curSession, getImage, cellSize } =
      item as React.ComponentProps<typeof SceneCell>;
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
    const { path, cellSize, imageSize } = item as React.ComponentProps<
      typeof CellPreview
    >;
    res = (
      <CellPreview
        path={path}
        cellSize={cellSize}
        imageSize={imageSize}
        style={style}
      />
    );
  } else if (itemType === 'piece') {
    const { piece, curPieceLibrary, name, width } =
      item as React.ComponentProps<typeof PieceCell>;
    res = (
      <PieceCell
        piece={piece}
        name={name}
        curPieceLibrary={curPieceLibrary}
        width={width}
        style={style}
      />
    );
  } else if (itemType === 'slot') {
    const { scene, piece } = item as React.ComponentProps<typeof SlotPiece>;
    res = <SlotPiece scene={scene} piece={piece} style={style} />;
  } else {
    return null;
  }
  return res;
}

export default observer(function LegacyWorkspace({
  legacyTool,
  darkMode,
  onOpenAuth,
  onReturn,
}: {
  legacyTool: 'session' | 'inpaint' | 'pieces';
  darkMode: boolean;
  onOpenAuth: () => void;
  onReturn: () => void;
}) {
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
  return (
    <DndProvider
      backend={isMobile ? TouchBackend : HTML5Backend}
      options={{
        enableTouchEvents: true,
        enableMouseEvents: false,
        delayTouchStart: 400,
      }}
    >
      <div
        className={`flex flex-col relative h-screen w-screen bg-white dark:bg-slate-900 ${
          darkMode ? 'dark' : ''
        }`}
      >
        <div className="z-30">
          <DnDPreview />
        </div>
        <ErrorBoundary onReturn={onReturn}>
          <FloatViewProvider>
            <AppContextMenu />
            {appState.externalImage && (
              <FloatView
                onEscape={() => {
                  appState.closeExternalImage();
                }}
                priority={1}
              >
                <ExternalImageView
                  image={appState.externalImage}
                  onClose={() => {
                    appState.closeExternalImage();
                  }}
                />
              </FloatView>
            )}
            <VerticalStack>
              <StackFixed>
                <TobBar
                  onOpenAuth={window.electron ? onOpenAuth : undefined}
                  onOpenPreview={window.electron ? onReturn : undefined}
                />
              </StackFixed>
              <StackGrow className="flex">
                {appState.curSession && (
                  <>
                    <StackGrow outerClassName="hidden md:block">
                      <PreSetEditor
                        key={appState.curSession.name}
                        middlePromptMode={false}
                      />
                    </StackGrow>
                    <StackGrow>
                      <TabComponent
                        key={appState.curSession.name}
                        tabs={tabs}
                        initialTab={tabs.findIndex(
                          (tab) => tab.tool === legacyTool,
                        )}
                        toggleView={
                          <PreSetEditor
                            key={`${appState.curSession.name}2`}
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
});

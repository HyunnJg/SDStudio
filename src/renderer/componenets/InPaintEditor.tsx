import { useEffect, useState } from 'react';
import { base64ToDataUri, pngBlob, readPNGBase64 } from '../models/pngData';
import WorkspaceMaskEditor, { type MaskImages } from './WorkspaceMaskEditor';
import { DropdownSelect } from './UtilComponents';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { FaArrowLeft, FaPlay, FaStop } from 'react-icons/fa';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  isMobile,
  imageService,
  workFlowService,
  taskQueueService,
} from '../models';
import { dataUriToBase64 } from '../models/ImageService';
import { InpaintScene } from '../models/types';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { InnerPreSetEditor } from './PreSetEdtior';
import { reaction } from 'mobx';
import { FloatView } from './FloatView';
import { TaskProgressBar } from './TaskQueueControl';
import { queueI2IWorkflow } from '../models/TaskQueueService';

interface Props {
  editingScene: InpaintScene;
  onConfirm: () => void;
  onDelete: () => void;
}

const InPaintEditor = observer(
  ({ editingScene, onConfirm, onDelete }: Props) => {
    const [_, rerender] = useState({});
    useEffect(() => {
      const handleProgress = () => {
        rerender({});
      };
      taskQueueService.addEventListener('start', handleProgress);
      taskQueueService.addEventListener('stop', handleProgress);
      taskQueueService.addEventListener('progress', handleProgress);
      return () => {
        taskQueueService.removeEventListener('start', handleProgress);
        taskQueueService.removeEventListener('stop', handleProgress);
        taskQueueService.removeEventListener('progress', handleProgress);
      };
    });
    const { curSession } = appState;
    const resolutionOptions = Object.entries(resolutionMap)
      .map(([key, value]) => {
        const resolVal =
          (editingScene.resolutionWidth ?? '') +
          'x' +
          (editingScene.resolutionHeight ?? '');
        if (key === 'custom')
          return { label: '커스텀 (' + resolVal + ')', value: key };
        return { label: `${value.width}x${value.height}`, value: key };
      })
      .filter((x) => !x.value.startsWith('small'));

    const [image, setImage] = useState('');
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    const [mask, setMask] = useState<string | undefined>(undefined);
    const [maskChanged, setMaskChanged] = useState(false);
    const [editingMask, setEditingMask] = useState<MaskImages>();
    const [open, setOpen] = useState(false);
    const def = workFlowService.getDef(editingScene.workflowType);
    useEffect(() => {
      let live = true;
      setMaskChanged(false);
      setEditingMask(undefined);
      if (!editingScene) {
        setImage('');
        setMask(undefined);
        return;
      }
      setImage('');
      setWidth(0);
      setHeight(0);
      setMask(undefined);
      async function loadImage() {
        try {
          const data = await imageService.fetchVibeImage(
            curSession!,
            editingScene.preset.image,
          );
          if (live) setImage(dataUriToBase64(data!));
        } catch (e) {
          appState.pushMessage('인페인트 이미지를 불러오는데 실패했습니다.');
        }
      }
      async function loadMask() {
        try {
          const data = await imageService.fetchVibeImage(
            curSession!,
            editingScene.preset.mask,
          );
          if (live) setMask(dataUriToBase64(data!));
        } catch (e) {}
      }
      const dispose = reaction(
        () => editingScene.preset.image,
        () => {
          loadImage();
        },
      );
      loadImage();
      if (def.hasMask && editingScene.preset.mask) loadMask();

      imageService.addEventListener('image-cache-invalidated', loadImage);
      return () => {
        live = false;
        imageService.removeEventListener('image-cache-invalidated', loadImage);
        dispose();
      };
    }, [editingScene]);
    const deleteScene = () => {
      appState.pushDialog({
        type: 'confirm',
        text: '정말로 해당 씬을 삭제하시겠습니까?',
        callback: () => {
          curSession!.inpaints.delete(editingScene!.name);
          onConfirm();
          onDelete();
        },
      });
    };

    const saveMask = async () => {
      if (def.hasMask) {
        if (editingScene.preset.mask && !maskChanged) return;
        let value = mask;
        if (!value) {
          if (!width || !height) throw Error('이미지를 먼저 불러오세요.');
          const blank = document.createElement('canvas');
          blank.width = width;
          blank.height = height;
          const ctx = blank.getContext('2d')!;
          ctx.fillRect(0, 0, width, height);
          value = dataUriToBase64(blank.toDataURL('image/png'));
        }
        if (!editingScene.preset.mask) {
          editingScene.preset.mask = await imageService.storeVibeImage(
            curSession!,
            value,
          );
        } else {
          await imageService.writeVibeImage(
            curSession!,
            editingScene.preset.mask,
            value,
          );
        }
        setMaskChanged(false);
      }
    };

    const confirm = async () => {
      await saveMask();
      onConfirm();
    };

    return (
      <div className="flex flex-col md:flex-row py-3 h-full w-full overflow-hidden">
        <div className="px-3 flex flex-col flex-none md:h-auto md:w-1/2 xl:w-1/3 gap-2 overflow-hidden">
          <div className="flex flex-wrap gap-2">
            <div className="mb-1 flex items-center gap-3 flex-none">
              <label className="gray-label">씬 이름: </label>
              <input
                type="text"
                className="gray-input flex-1"
                value={editingScene.name}
                onChange={(e) => {
                  editingScene.name = e.target.value;
                }}
              />
              {editingScene && (
                <button
                  className={`round-button back-red`}
                  onClick={deleteScene}
                >
                  삭제
                </button>
              )}
              <button className={`round-button back-sky`} onClick={confirm}>
                저장
              </button>
            </div>
            <div className="flex-none inline-flex md:flex whitespace-nowrap gap-3 items-center">
              {!isMobile && <span className="gray-label">해상도:</span>}
              <div className="w-36">
                <DropdownSelect
                  options={resolutionOptions}
                  menuPlacement="bottom"
                  selectedOption={editingScene.resolution}
                  onSelect={async (opt) => {
                    if (
                      opt.value.startsWith('large') ||
                      opt.value.startsWith('wallpaper')
                    ) {
                      appState.pushDialog({
                        type: 'confirm',
                        text: '해당 해상도는 Anlas를 소모합니다 (유로임) 계속하시겠습니까?',
                        callback: () => {
                          editingScene.resolution = opt.value as Resolution;
                        },
                      });
                    } else if (opt.value === 'custom') {
                      const width = await appState.pushDialogAsync({
                        type: 'input-confirm',
                        text: '해상도 너비를 입력해주세요',
                      });
                      if (width == null) return;
                      const height = await appState.pushDialogAsync({
                        type: 'input-confirm',
                        text: '해상도 높이를 입력해주세요',
                      });
                      if (height == null) return;
                      try {
                        const customResolution = {
                          width: parseInt(width),
                          height: parseInt(height),
                        };
                        editingScene.resolution = opt.value as Resolution;
                        editingScene.resolutionWidth =
                          (customResolution.width + 63) & ~63;
                        editingScene.resolutionHeight =
                          (customResolution.height + 63) & ~63;
                      } catch (e: any) {
                        appState.pushMessage(e.message);
                      }
                    } else {
                      editingScene.resolution = opt.value as Resolution;
                    }
                  }}
                />
              </div>
            </div>
          </div>
          {open && (
            <FloatView priority={1} onEscape={() => setOpen(false)}>
              <InnerPreSetEditor
                type={editingScene.workflowType}
                preset={editingScene.preset}
                shared={undefined}
                element={workFlowService.getI2IEditor(
                  editingScene.workflowType,
                )}
                middlePromptMode={false}
              />
            </FloatView>
          )}
          <div className="flex-none md:hidden mb-2">
            <button
              className="round-button back-sky w-full"
              onClick={() => setOpen(true)}
            >
              씬 세팅 열기
            </button>
          </div>
          <div className="flex-1 hidden md:block overflow-hidden">
            <InnerPreSetEditor
              nopad
              type={editingScene.workflowType}
              preset={editingScene.preset}
              shared={undefined}
              element={workFlowService.getI2IEditor(editingScene.workflowType)}
              middlePromptMode={false}
            />
          </div>
          {def.hasMask && (
            <button
              className="round-button back-sky"
              disabled={
                !width ||
                !height ||
                !image ||
                (!!editingScene.preset.mask && !mask)
              }
              onClick={() =>
                setEditingMask({
                  source: pngBlob(image),
                  mask: mask ? pngBlob(mask) : undefined,
                  width,
                  height,
                })
              }
            >
              마스크 편집
            </button>
          )}
          {editingMask && (
            <WorkspaceMaskEditor
              images={editingMask}
              allowEmpty
              onClose={() => setEditingMask(undefined)}
              onSave={async (file) => {
                setMask(await readPNGBase64(file));
                setMaskChanged(true);
                return true;
              }}
            />
          )}
        </div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <TransformWrapper
              minScale={0.7}
              initialScale={0.7}
              centerOnInit={true}
            >
              <TransformComponent wrapperClass="wrapper flex-none items-center justify-center">
                {image && (
                  <img
                    src={base64ToDataUri(image)}
                    width={width}
                    height={height}
                    alt="변형 원본"
                    onLoad={(e) => {
                      setWidth(e.currentTarget.naturalWidth);
                      setHeight(e.currentTarget.naturalHeight);
                    }}
                  />
                )}
              </TransformComponent>
            </TransformWrapper>
          </div>
          <div className="flex-none flex ml-auto gap-2 items-center mr-2 mt-2">
            <button
              className={`round-button back-gray h-8 w-16 flex items-center justify-center`}
              onClick={async () => {
                if (!image || !editingScene.preset.image) return;
                await imageService.writeVibeImage(
                  curSession!,
                  editingScene.preset.image,
                  image,
                );
              }}
            >
              <FaArrowLeft size={20} />
            </button>
            <TaskProgressBar fast />
            {!taskQueueService.isRunning() ? (
              <button
                className={`round-button back-green h-8 w-16 md:w-36 flex items-center justify-center`}
                onClick={async () => {
                  await saveMask();
                  await queueI2IWorkflow(
                    curSession!,
                    editingScene.workflowType,
                    editingScene.preset,
                    editingScene,
                    1,
                    (path: string) => {
                      (async () => {
                        const data = await imageService.fetchImage(path);
                        setImage(dataUriToBase64(data!));
                      })();
                    },
                  );
                  taskQueueService.run();
                }}
              >
                <FaPlay size={15} />
              </button>
            ) : (
              <button
                className={`round-button back-red h-8 w-16 md:w-36 flex items-center justify-center`}
                onClick={() => {
                  taskQueueService.removeAllTasks();
                  taskQueueService.stop();
                }}
              >
                <FaStop size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default InPaintEditor;

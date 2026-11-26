/* eslint react/require-default-props: ["error", {"functions": "defaultArguments"}] */
/* eslint no-void: off -- Local image loading effects handle fixed UI failures. */
import { useEffect, useRef, useState, useMemo } from 'react';
import type { GenerationClient } from '../../workspaceGeneration';
import { projectErrorMessage } from '../projects/projectController';
import type { ProjectClient, ProjectImage } from '../../workspaceProject';
import ThumbnailQueue from '../generation/thumbnailQueue';
import { scenesWithoutPicks } from '../generation/generationPresentation';

interface ThumbnailProps {
  image: ProjectImage;
  number: number;
  selected: boolean;
  marked?: boolean;
  editingPicks: boolean;
  selectedURL: string;
  load: () => ReturnType<GenerationClient['image']>;
  queue: ThumbnailQueue;
  onSelect: () => void;
  actionLabel: string;
  disabled: boolean;
}
function Thumbnail({
  image,
  number,
  selected,
  marked = undefined,
  editingPicks,
  selectedURL,
  load,
  queue,
  onSelect,
  actionLabel,
  disabled,
}: ThumbnailProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setURL] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!button.current || typeof IntersectionObserver === 'undefined')
      return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      {
        root:
          button.current.closest('.connected-sidebar-scroll') ??
          button.current.closest('.connected-sidebar-panel'),
        rootMargin: '80px',
      },
    );
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectURL = '';
    setURL('');
    setFailed(false);
    // The selected image is already read for the canvas; reuse that URL.
    if (visible && !selected) {
      void queue
        .read(load, controller.signal)
        .then((reply) => {
          if (controller.signal.aborted) return undefined;
          if (!reply.ok) {
            setFailed(true);
            return undefined;
          }
          objectURL = URL.createObjectURL(
            new Blob([Uint8Array.from(reply.value)], { type: 'image/png' }),
          );
          setURL(objectURL);
          return undefined;
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    }
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [visible, selected, load, queue]);
  const source = selected ? selectedURL : url;
  return (
    <button
      ref={button}
      type="button"
      className="connected-thumbnail"
      aria-pressed={editingPicks ? marked : selected}
      data-image-id={image.id}
      data-restore-result={actionLabel ? image.id : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {(editingPicks || marked) && (
        <span
          className="gallery-mark"
          data-picked={!!marked}
          aria-label={marked ? '선별됨' : undefined}
        >
          {marked ? '✓' : ''}
        </span>
      )}
      <span className="connected-thumbnail-preview">
        {source && !failed ? (
          <img
            src={source}
            alt={`결과 ${number} 미리보기`}
            onError={() => setFailed(true)}
          />
        ) : (
          <span>{failed ? '미리보기를 읽지 못했습니다' : '원본 PNG'}</span>
        )}
      </span>
      <span className="connected-thumbnail-caption">
        <strong>
          결과 {number}
          {actionLabel && ` · ${actionLabel}`}
        </strong>
        <span>시드 {image.seed}</span>
      </span>
    </button>
  );
}
interface Props {
  client: GenerationClient;
  projectId: string | undefined;
  images: ProjectImage[];
  selected: string;
  selectedURL: string;
  onSelect: (id: string) => void;
  projects?: Pick<
    ProjectClient,
    'exportResults' | 'resultPicks' | 'setResultPicks'
  >;
  revision?: string;
  scenes?: { id: string; name: string }[];
  queueSceneIds?: string[];
  onPrepareMissing?: (ids: string[]) => void;
  actionLabel?: string;
  disabled?: boolean;
}
export default function ConnectedImageHistory({
  client,
  projectId,
  images,
  selected,
  selectedURL,
  onSelect,
  projects = undefined,
  revision = undefined,
  scenes = [],
  queueSceneIds = [],
  onPrepareMissing = undefined,
  actionLabel = '',
  disabled = false,
}: Props) {
  // This component owns its project scope even if a caller does not key/remount it.
  const scope = useMemo(
    () => ({
      client,
      projectId,
      queue: new ThumbnailQueue(),
      loaders: new Map<string, () => ReturnType<GenerationClient['image']>>(),
    }),
    [client, projectId],
  );
  const { queue, loaders } = scope;
  const [selecting, setSelecting] = useState(false);
  const [scene, setScene] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [picks, setPicks] = useState<Set<string>>();
  const [pickError, setPickError] = useState('');
  const [reload, setReload] = useState(0);
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    if (!projectId || !projects) return undefined;
    let alive = true;
    setPicks(undefined);
    setPickError('');
    void projects
      .resultPicks(projectId)
      .then((reply) => {
        if (!alive) return undefined;
        if (reply.ok) setPicks(new Set(reply.value));
        else setPickError(projectErrorMessage(reply.code));
        return undefined;
      })
      .catch(() => {
        if (alive) setPickError('선별 목록을 읽지 못했습니다.');
      });
    return () => {
      alive = false;
    };
  }, [projectId, projects, reload]);

  const sceneIds = [...new Set(images.map((image) => image.sceneId))];
  const scoped =
    selecting && scene ? images.filter((i) => i.sceneId === scene) : images;
  const ids = scoped.filter((i) => picks?.has(i.id)).map((i) => i.id);
  const saveIds = selecting
    ? ids
    : images.filter((i) => i.id === selected).map((i) => i.id);
  const count = images.filter((i) => picks?.has(i.id)).length;
  const missing = picks
    ? scenesWithoutPicks(
        scene ? queueSceneIds.filter((id) => id === scene) : queueSceneIds,
        images,
        picks,
      )
    : [];
  const changePicks = async (changed: string[], picked: boolean) => {
    if (
      !projectId ||
      !revision ||
      !projects ||
      !picks ||
      writing ||
      !changed.length
    )
      return;
    setWriting(true);
    setPickError('');
    try {
      const reply = await projects.setResultPicks(
        projectId,
        revision,
        changed,
        picked,
      );
      if (reply.ok) setPicks(new Set(reply.value));
      else setPickError(projectErrorMessage(reply.code));
    } catch {
      setPickError('선별 목록을 저장하지 못했습니다.');
    } finally {
      setWriting(false);
    }
  };
  const saveLabel =
    saveIds.length > 1 ? `ZIP 저장 (${saveIds.length}장)` : 'PNG 저장';
  const save = async () => {
    if (!projects || !projectId || saving || !saveIds.length) return;
    setSaving(true);
    setExportError('');
    try {
      const reply = await projects.exportResults(projectId, saveIds);
      if (!reply.ok) {
        const errors = {
          PROJECT_BUSY: '다른 저장이 끝나면 다시 시도해 주세요.',
          PROJECT_NOT_FOUND: '프로젝트 또는 선택한 결과를 찾을 수 없습니다.',
          PROJECT_INPUT: '앱 데이터 폴더 밖에 해당 확장자로 저장해 주세요.',
          PROJECT_IO: '파일을 저장하지 못했습니다. 저장 위치를 확인해 주세요.',
          PROJECT_CORRUPT: '선택한 원본 이미지를 읽을 수 없습니다.',
        };
        setExportError(
          errors[reply.code as keyof typeof errors] ??
            projectErrorMessage(reply.code),
        );
      }
    } catch {
      setExportError('결과 파일을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };
  const select = (id: string) => {
    if (selecting) void changePicks([id], !picks?.has(id));
    else onSelect(id);
  };

  const getLoader = (id: string) => {
    let loader = loaders.get(id);
    if (!loader) {
      loader = () => scope.client.image(scope.projectId!, id);
      loaders.set(id, loader);
    }
    return loader;
  };
  const showPickControls =
    images.length > 0 || (projectId && queueSceneIds.length > 0);
  return (
    <>
      {projects && showPickControls && (
        <div className="gallery-export" aria-label="결과 저장">
          <button
            type="button"
            disabled={saving || writing || !picks}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setScene('');
              setOnlyPicked(false);
              setExportError('');
            }}
          >
            {selecting ? '선별 종료' : `선별${count ? ` (${count})` : ''}`}
          </button>
          {selecting && (
            <>
              {sceneIds.length > 1 || scene ? (
                <select
                  aria-label="선별할 씬"
                  value={scene}
                  disabled={writing || saving}
                  onChange={(event) => setScene(event.target.value)}
                >
                  <option value="">전체 씬</option>
                  {[...new Set([...sceneIds, ...(scene ? [scene] : [])])].map(
                    (id) => (
                      <option key={id} value={id}>
                        {scenes.find((item) => item.id === id)?.name ??
                          `이전 씬 (${id})`}
                      </option>
                    ),
                  )}
                </select>
              ) : null}
              <label htmlFor="gallery-only-picked">
                <input
                  id="gallery-only-picked"
                  type="checkbox"
                  checked={onlyPicked}
                  onChange={(event) => setOnlyPicked(event.target.checked)}
                />
                선별만 보기
              </label>
              <button
                type="button"
                disabled={
                  onlyPicked ||
                  !scoped.length ||
                  saving ||
                  writing ||
                  !picks ||
                  !!pickError
                }
                onClick={() =>
                  void changePicks(
                    scoped.map((i) => i.id),
                    ids.length !== scoped.length,
                  )
                }
              >
                {ids.length > 0 && ids.length === scoped.length
                  ? '모두 해제'
                  : '모두 선별'}
              </button>
              <button
                type="button"
                data-testid="prepare-unpicked"
                disabled={
                  !onPrepareMissing ||
                  !missing.length ||
                  writing ||
                  saving ||
                  !!pickError
                }
                onClick={() => onPrepareMissing?.(missing)}
              >
                {queueSceneIds.length
                  ? `예약 대상 중 선별 없는 씬 ${missing.length}개 다시 담기`
                  : '반복 생성에서 예약할 씬을 선택하세요'}
              </button>
            </>
          )}
          <button
            type="button"
            data-testid="gallery-save"
            disabled={
              saving || writing || !saveIds.length || (selecting && !!pickError)
            }
            onClick={save}
          >
            {saving ? '저장 중…' : saveLabel}
          </button>
          {pickError && (
            <small role="alert">
              {pickError}{' '}
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                선별 다시 읽기
              </button>
            </small>
          )}
          {exportError && <small role="alert">{exportError}</small>}
        </div>
      )}
      <div className="connected-history" aria-label="저장된 결과 목록">
        {!images.length && (
          <p className="connected-history-empty">아직 이미지가 없습니다.</p>
        )}
        {onlyPicked && !ids.length && (
          <p className="connected-history-empty">선별한 결과가 없습니다.</p>
        )}
        {projectId &&
          [...scoped]
            .filter((image) => !onlyPicked || picks?.has(image.id))
            .reverse()
            .map((image) => (
              <Thumbnail
                key={`${projectId}:${image.id}`}
                image={image}
                number={images.indexOf(image) + 1}
                selected={selected === image.id}
                selectedURL={selectedURL}
                load={getLoader(image.id)}
                queue={queue}
                marked={picks?.has(image.id)}
                editingPicks={selecting}
                onSelect={() => select(image.id)}
                actionLabel={actionLabel}
                disabled={
                  disabled ||
                  saving ||
                  (selecting && (writing || !picks || !!pickError))
                }
              />
            ))}
      </div>
    </>
  );
}

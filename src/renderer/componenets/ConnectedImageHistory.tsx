/* eslint react/require-default-props: ["error", {"functions": "defaultArguments"}] */
/* eslint no-void: off -- Local image loading effects handle fixed UI failures. */
import { useEffect, useRef, useState, useMemo } from 'react';
import type { GenerationClient } from '../../workspaceGeneration';
import { projectErrorMessage } from '../projects/projectController';
import type { ProjectClient, ProjectImage } from '../../workspaceProject';
import ThumbnailQueue from '../generation/thumbnailQueue';

interface ThumbnailProps {
  image: ProjectImage;
  number: number;
  selected: boolean;
  marked?: boolean;
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
      aria-pressed={marked ?? selected}
      data-image-id={image.id}
      data-restore-result={actionLabel ? image.id : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {marked !== undefined && (
        <span aria-hidden="true" className="gallery-mark">
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
  exportResults?: ProjectClient['exportResults'];
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
  exportResults = undefined,
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
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportError, setExportError] = useState('');
  const ids = images
    .filter((image) => selection?.has(image.id))
    .map((image) => image.id);
  const saveIds = selection
    ? ids
    : images.filter((image) => image.id === selected).map((image) => image.id);
  const saveLabel =
    saveIds.length > 1 ? `ZIP 저장 (${saveIds.length}장)` : 'PNG 저장';
  const save = async () => {
    if (!exportResults || !projectId || saving || !saveIds.length) return;
    setSaving(true);
    setExportError('');
    try {
      const reply = await exportResults(projectId, saveIds);
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
    if (!selection) {
      onSelect(id);
      return;
    }
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection(next);
  };

  const getLoader = (id: string) => {
    let loader = loaders.get(id);
    if (!loader) {
      loader = () => scope.client.image(scope.projectId!, id);
      loaders.set(id, loader);
    }
    return loader;
  };
  return (
    <>
      {exportResults && images.length > 0 && (
        <div className="gallery-export" aria-label="결과 저장">
          <button
            type="button"
            disabled={saving}
            aria-pressed={!!selection}
            onClick={() => {
              setSelection(selection ? null : new Set());
              setExportError('');
            }}
          >
            {selection ? '선택 종료' : '여러 장 선택'}
          </button>
          {selection && (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                setSelection(
                  ids.length === images.length
                    ? new Set()
                    : new Set(images.map((i) => i.id)),
                )
              }
            >
              {ids.length === images.length ? '선택 해제' : '전체 선택'}
            </button>
          )}
          <button
            type="button"
            data-testid="gallery-save"
            disabled={saving || !saveIds.length}
            onClick={save}
          >
            {saving ? '저장 중…' : saveLabel}
          </button>
          {exportError && <small role="alert">{exportError}</small>}
        </div>
      )}
      <div className="connected-history" aria-label="저장된 결과 목록">
        {!images.length && (
          <p className="connected-history-empty">아직 이미지가 없습니다.</p>
        )}
        {projectId &&
          [...images]
            .reverse()
            .map((image, index) => (
              <Thumbnail
                key={`${projectId}:${image.id}`}
                image={image}
                number={images.length - index}
                selected={selected === image.id}
                selectedURL={selectedURL}
                load={getLoader(image.id)}
                queue={queue}
                marked={selection ? selection.has(image.id) : undefined}
                onSelect={() => select(image.id)}
                actionLabel={actionLabel}
                disabled={disabled || saving}
              />
            ))}
      </div>
    </>
  );
}

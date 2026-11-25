/* eslint react/require-default-props: ["error", {"functions": "defaultArguments"}] */
/* eslint no-void: off -- Local image loading effects handle fixed UI failures. */
import { useEffect, useRef, useState, useMemo } from 'react';
import type { GenerationClient } from '../../workspaceGeneration';
import type { ProjectImage } from '../../workspaceProject';
import ThumbnailQueue from '../generation/thumbnailQueue';

interface ThumbnailProps {
  image: ProjectImage;
  number: number;
  selected: boolean;
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
      aria-pressed={selected}
      data-image-id={image.id}
      data-restore-result={actionLabel ? image.id : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
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
  const getLoader = (id: string) => {
    let loader = loaders.get(id);
    if (!loader) {
      loader = () => scope.client.image(scope.projectId!, id);
      loaders.set(id, loader);
    }
    return loader;
  };
  return (
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
              onSelect={() => onSelect(image.id)}
              actionLabel={actionLabel}
              disabled={disabled}
            />
          ))}
    </div>
  );
}

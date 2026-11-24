/* eslint no-void: off -- Local image loading effects handle fixed UI failures. */
import { useEffect, useRef, useState } from 'react';
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
}
function Thumbnail({
  image,
  number,
  selected,
  selectedURL,
  load,
  queue,
  onSelect,
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
        root: button.current.closest('.connected-sidebar-panel'),
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
        <strong>결과 {number}</strong>
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
}
export default function ConnectedImageHistory({
  client,
  projectId,
  images,
  selected,
  selectedURL,
  onSelect,
}: Props) {
  const [queue] = useState(() => new ThumbnailQueue());
  // Stable functions avoid re-reading visible thumbnails when selection/status changes.
  const loaders = useRef(
    new Map<string, () => ReturnType<GenerationClient['image']>>(),
  );
  const getLoader = (id: string) => {
    let loader = loaders.current.get(id);
    if (!loader) {
      loader = () => client.image(projectId!, id);
      loaders.current.set(id, loader);
    }
    return loader;
  };
  return (
    <div className="connected-history" aria-label="저장된 결과 목록">
      {!images.length && (
        <p className="connected-history-empty">
          생성한 이미지가 이곳에 쌓입니다.
          <br />
          원본 비율로 보고, 선택해 크게 열어 보세요.
        </p>
      )}
      {projectId &&
        [...images]
          .reverse()
          .map((image, index) => (
            <Thumbnail
              key={image.id}
              image={image}
              number={images.length - index}
              selected={selected === image.id}
              selectedURL={selectedURL}
              load={getLoader(image.id)}
              queue={queue}
              onSelect={() => onSelect(image.id)}
            />
          ))}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { ProjectImage } from '../../workspaceProject';
import type { GenerationClient } from '../../workspaceGeneration';
import ConnectedImageHistory from './ConnectedImageHistory';

interface Props {
  client: GenerationClient;
  projectId: string | undefined;
  error: string;
  images: ProjectImage[];
  locked: boolean;
  onRestore: (id: string) => void;
  onClose: () => void;
}
export default function WorkspaceResultTrash({
  client,
  projectId,
  error,
  images,
  locked,
  onRestore,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workspace-project-dialog"
      data-testid="result-trash-dialog"
      aria-label="결과 휴지통"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      <h2>결과 휴지통</h2>
      <small>
        원본 PNG와 이력은 보관되며 보관 한도에 포함됩니다. 복원하면 결과 목록에
        다시 나타납니다.
      </small>
      {images.length === 0 && <p>휴지통이 비었습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {images.length > 0 && (
        <div className="result-trash-history connected-sidebar-panel">
          <ConnectedImageHistory
            client={client}
            projectId={projectId}
            images={images}
            selected=""
            selectedURL=""
            onSelect={onRestore}
            actionLabel="복원"
            disabled={locked}
          />
        </div>
      )}
      <button
        type="button"
        disabled={locked}
        data-testid="result-trash-close"
        onClick={onClose}
      >
        닫기
      </button>
    </dialog>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { ProjectImage, ResultTrashReport } from '../../workspaceProject';
import type { GenerationClient } from '../../workspaceGeneration';
import ConnectedImageHistory from './ConnectedImageHistory';

interface Props {
  client: GenerationClient;
  projectId: string | undefined;
  error: string;
  images: ProjectImage[];
  locked: boolean;
  revision: string | undefined;
  report: ResultTrashReport | undefined;
  onEmpty: (revision: string) => void;
  onRestore: (id: string) => void;
  onClose: () => void;
}
export default function WorkspaceResultTrash({
  client,
  projectId,
  error,
  images,
  locked,
  revision,
  report,
  onEmpty,
  onRestore,
  onClose,
}: Props) {
  const [confirmation, setConfirmation] = useState<string>();
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
      <small>휴지통의 결과도 프로젝트 보관 한도에 포함됩니다.</small>
      {images.length === 0 && !report && <p>휴지통이 비었습니다.</p>}
      {report && (
        <p role="status" data-testid="result-trash-report">
          결과 자리 {report.removedResults}개 확보 · PNG 파일{' '}
          {report.deletedFiles}개 정리 ({report.deletedBytes.toLocaleString()}
          바이트)
          {report.removedResults > 0 &&
            report.deletedBytes === 0 &&
            !report.cleanupIncomplete &&
            ' · 이력 복구용 PNG 보존'}
          {report.cleanupIncomplete && ' · 일부 파일 정리 보류'}
        </p>
      )}
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
      {revision &&
        (confirmation === revision ? (
          <section aria-label="파일 정리 확인">
            <p>
              {images.length > 0 &&
                `휴지통의 결과 ${images.length}장을 현재 프로젝트에서 비웁니다. `}
              이력 복구에 필요한 PNG는 보존하고, 사용되지 않는 결과 파일만
              지웁니다.
            </p>
            <button
              type="button"
              disabled={locked}
              data-testid="cancel-empty-result-trash"
              onClick={() => setConfirmation(undefined)}
            >
              취소
            </button>
            <button
              type="button"
              disabled={locked}
              data-testid="confirm-empty-result-trash"
              onClick={() => {
                setConfirmation(undefined);
                onEmpty(revision);
              }}
            >
              {images.length ? '비우기 확인' : '파일 정리 확인'}
            </button>
          </section>
        ) : (
          <button
            type="button"
            disabled={locked}
            data-testid="empty-result-trash"
            onClick={() => setConfirmation(revision)}
          >
            {images.length ? '휴지통 비우기' : '미사용 결과 파일 정리'}
          </button>
        ))}
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

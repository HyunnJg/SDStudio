import { useEffect, useRef } from 'react';

interface Props {
  file: File;
  canReference: boolean;
  canVariation: boolean;
  canInpaint: boolean;
  onInpaint: () => void;
  onVariation: () => void;
  onMetadata: () => void;
  onReference: () => void;
  onClose: () => void;
}
export default function WorkspaceImageChoice({
  file,
  canReference,
  canVariation,
  canInpaint,
  onInpaint,
  onVariation,
  onMetadata,
  onReference,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workspace-image-choice"
      data-testid="image-choice"
      aria-label="이미지 사용 방식"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>이 이미지로 무엇을 할까요?</h2>
        <button type="button" onClick={onClose} aria-label="이미지 선택 닫기">
          ×
        </button>
      </header>
      <p className="workspace-image-filename">{file.name}</p>
      <div className="workspace-image-options">
        <button
          type="button"
          data-testid="image-use-metadata"
          onClick={onMetadata}
        >
          <strong>프롬프트·설정 가져오기</strong>
          <small>이미지에 담긴 입력을 읽습니다.</small>
        </button>
        <button
          type="button"
          data-testid="image-use-variation"
          disabled={!canVariation}
          onClick={onVariation}
        >
          <strong>이 이미지로 변형</strong>
          <small>원본 구도를 바탕으로 새로운 결과를 생성합니다.</small>
        </button>
        <button
          type="button"
          data-testid="image-use-inpaint"
          disabled={!canInpaint}
          onClick={onInpaint}
        >
          <strong>인페인팅 마스크 편집</strong>
          <small>V3 Anime에서 칠한 영역을 다시 생성합니다.</small>
        </button>
        <button
          type="button"
          data-testid="image-use-reference"
          disabled={!canReference}
          title={
            canReference ? '생성 이미지 참조' : 'V5 High 또는 Curated에서 사용'
          }
          onClick={onReference}
        >
          <strong>이미지 레퍼런스</strong>
          <small>V5 생성의 캐릭터·화풍·의상을 참조합니다.</small>
        </button>
      </div>
    </dialog>
  );
}

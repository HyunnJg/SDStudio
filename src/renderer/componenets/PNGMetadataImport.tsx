/* eslint react/no-array-index-key: off, no-void: off, jsx-a11y/label-has-associated-control: ["error", {"assert":"either"}] -- Explicit input labels and handled file reads. */
import { useState, useEffect, useRef } from 'react';
import type { WorkspaceDraft } from '../preview/workspaceDraft';
import { PNG_IMPORT_LIMITS, PNGMetadataError } from '../metadata/pngMetadata';
import {
  planMetadataImport,
  applyMetadataImport,
  availableImportFields,
} from '../metadata/metadataImport';
import type {
  ImportField,
  MetadataImportPlan,
} from '../metadata/metadataImport';

import readImageMetadata from '../metadata/imageMetadata';
import { imageFormat } from '../../workspaceReference';

const labels: Record<ImportField, string> = {
  prompt: '기본 프롬프트',
  negativePrompt: '부정 프롬프트',
  characters: '캐릭터 텍스트 · 자동 배치',
  settings: '생성 설정 · 현재 모델 유지',
  seed: '시드 · 고정으로 전환',
};
interface Props {
  file: File | undefined;
  draft: WorkspaceDraft;
  locked: boolean;
  onClose: () => void;
  onApply: (draft: WorkspaceDraft, characters: boolean) => void;
}
export default function PNGMetadataImport({
  file,
  draft,
  locked,
  onClose,
  onApply,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<MetadataImportPlan>();
  const [fields, setFields] = useState<ImportField[]>([]);
  const [error, setError] = useState('');
  const [url, setURL] = useState('');
  const [loading, setLoading] = useState(false);
  const initial = useRef(draft);
  initial.current = draft;
  useEffect(() => {
    const controller = new AbortController();
    let preview = '';
    setPlan(undefined);
    setFields([]);
    setError('');
    setURL('');
    setLoading(!!file);
    if (file) {
      dialog.current?.showModal();
      void (async () => {
        try {
          if (file.size > PNG_IMPORT_LIMITS.bytes)
            throw new PNGMetadataError('PNG_LIMIT');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (controller.signal.aborted) return;
          const metadata = await readImageMetadata(bytes, controller.signal);
          if (controller.signal.aborted) return;
          const prepared = planMetadataImport(metadata, initial.current);
          if (!availableImportFields(prepared).length)
            throw new PNGMetadataError('PNG_MISSING');
          setPlan(prepared);
          setFields(availableImportFields(prepared));
          preview = URL.createObjectURL(
            new Blob([Uint8Array.from(bytes)], {
              type: `image/${imageFormat(bytes)}`,
            }),
          );
          setURL(preview);
        } catch (failure) {
          if (controller.signal.aborted) return;
          const code =
            failure instanceof PNGMetadataError ? failure.code : 'PNG_METADATA';
          const messages = {
            PNG_LIMIT: '이미지 또는 메타데이터 크기·픽셀 한도를 넘었습니다.',
            PNG_INPUT: 'PNG·WebP·JPEG 파일을 선택해 주세요.',
            PNG_MISSING: '이 이미지에서 가져올 생성 정보를 찾지 못했습니다.',
            PNG_METADATA:
              '메타데이터를 해석하지 못했습니다. 현재 입력은 유지됩니다.',
            CANCELLED: '읽기를 취소했습니다.',
          };
          setError(messages[code]);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    } else dialog.current?.close();
    return () => {
      controller.abort();
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [file]);
  const disabledPresets = [
    fields.includes('prompt') && '품질 태그',
    fields.includes('negativePrompt') && '부정 프리셋',
  ]
    .filter(Boolean)
    .join('·');
  const close = () => {
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="connected-import-dialog"
      aria-label="이미지 메타데이터 가져오기"
      data-testid="metadata-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2>이미지에서 입력 가져오기</h2>
        <button type="button" aria-label="메타데이터 창 닫기" onClick={close}>
          닫기
        </button>
      </header>
      {loading && <p role="status">이미지 정보를 읽고 있습니다…</p>}
      {error && <p role="alert">{error}</p>}
      {plan && (
        <>
          {url && (
            <img
              className="connected-import-preview"
              src={url}
              alt="가져올 이미지 미리보기"
            />
          )}
          <fieldset disabled={locked}>
            <legend>가져올 항목</legend>
            {availableImportFields(plan).map((field) => (
              <div key={field} className="connected-import-field">
                <label>
                  <input
                    type="checkbox"
                    data-import-field={field}
                    checked={fields.includes(field)}
                    onChange={(event) =>
                      setFields((previous) =>
                        event.target.checked
                          ? [...previous, field]
                          : previous.filter((item) => item !== field),
                      )
                    }
                  />
                  {labels[field]}
                  {field === 'characters' &&
                    ` · ${plan.characters!.length}명으로 대체`}
                </label>
              </div>
            ))}
          </fieldset>
          {disabledPresets && (
            <p className="connected-import-note">
              {disabledPresets} 자동 추가를 끕니다.
            </p>
          )}
          {plan.notices.length > 0 && (
            <ul className="connected-import-note">
              {plan.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}
          <footer>
            <button
              type="button"
              disabled={locked || fields.length === 0}
              data-testid="apply-metadata"
              onClick={() => {
                if (!locked) {
                  onApply(
                    applyMetadataImport(draft, plan, fields),
                    fields.includes('characters'),
                  );
                  close();
                }
              }}
            >
              선택한 항목 가져오기
            </button>
            <button type="button" onClick={close}>
              취소
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}

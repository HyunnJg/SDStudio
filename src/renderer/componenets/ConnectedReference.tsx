/* eslint no-void: off -- File selection invokes a bounded asynchronous local operation. */
import { useEffect, useRef, useState } from 'react';
import type { GenerationClient } from '../../workspaceGeneration';
import type {
  WorkspaceReference,
  ReferenceRole,
} from '../../workspaceReference';
import {
  REFERENCE_ROLES,
  REFERENCE_COST_NOTICE,
} from '../../workspaceReference';

interface Props {
  reference: WorkspaceReference | undefined;
  projectId: string | undefined;
  sceneId: string;
  family: string;
  locked: boolean;
  preview: { hash: string; bytes: Uint8Array } | undefined;
  client: GenerationClient;
  onFile: (file: File) => Promise<void>;
  onChange: (reference: WorkspaceReference | undefined) => void;
}
export default function ConnectedReference({
  reference,
  projectId,
  sceneId,
  family,
  locked,
  preview,
  client,
  onFile,
  onChange,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [url, setURL] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const hash = reference?.uploadHash;
  useEffect(() => {
    let alive = true;
    let objectURL = '';
    setURL('');
    setUnavailable(false);
    if (hash) {
      let bytes: Promise<Uint8Array>;
      if (preview && preview.hash === hash)
        bytes = Promise.resolve(preview.bytes);
      else if (projectId)
        bytes = client.referenceImage(projectId, sceneId).then((r) => {
          if (!r.ok) throw new Error(r.code);
          return r.value;
        });
      else bytes = Promise.reject(new Error('missing'));
      void bytes
        .then((value) => {
          if (!alive) return undefined;
          objectURL = URL.createObjectURL(
            new Blob([new Uint8Array(value)], { type: 'image/png' }),
          );
          setURL(objectURL);
          return undefined;
        })
        .catch(() => {
          if (alive) setUnavailable(true);
        });
    }
    return () => {
      alive = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [projectId, sceneId, hash, preview, client]);
  return (
    <section
      className="connected-reference"
      data-testid="reference-panel"
      aria-label="생성 이미지 참조"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!locked && family === 'v5' && e.dataTransfer.files.length === 1)
          void onFile(e.dataTransfer.files[0]);
      }}
    >
      <header>
        <strong>이미지 레퍼런스</strong>
        <small>V5 Full · 1장</small>
      </header>
      <p>
        PNG를 선택하거나 여기에 끌어놓으세요. 프롬프트·설정 가져오기와
        별개입니다.
      </p>
      <input
        ref={file}
        type="file"
        accept="image/png,.png"
        hidden
        aria-label="참조로 사용할 PNG"
        data-testid="reference-file"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = '';
          if (selected && !locked && family === 'v5') void onFile(selected);
        }}
      />
      <button
        type="button"
        data-testid="choose-reference"
        disabled={locked || family !== 'v5'}
        onClick={() => file.current?.click()}
      >
        {reference ? '참조 PNG 바꾸기' : '참조 PNG 선택'}
      </button>
      {family !== 'v5' && (
        <p role="status">
          이미지 참조는 V5 Full에서 사용합니다.
          {reference && ' 참조를 해제하거나 V5로 전환해야 생성할 수 있습니다.'}
        </p>
      )}
      {reference && (
        <>
          {url && <img src={url} alt="전송용 참조 이미지 미리보기" />}
          {unavailable && (
            <p role="alert">
              참조를 읽지 못했습니다. 다시 선택해 주세요. 참조 없이 자동
              생성하지 않습니다.
            </p>
          )}
          <small>
            전송용 {reference.width}×{reference.height} · 중앙 자르기 ·
            메타데이터 제외. 원본은 별도 보관합니다.
          </small>
          <label htmlFor="reference-role">
            참조 대상
            <select
              id="reference-role"
              aria-label="참조 대상"
              data-testid="reference-role"
              disabled={locked || family !== 'v5'}
              value={reference.role}
              onChange={(e) => {
                const role = e.target.value as ReferenceRole;
                onChange({
                  ...reference,
                  role,
                  preferSameOutfit:
                    (role === 'character' || role === 'character-style') &&
                    reference.preferSameOutfit,
                });
              }}
            >
              {Object.entries(REFERENCE_ROLES).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="reference-strength">
            강도 {reference.strength}
            <input
              id="reference-strength"
              aria-label="참조 강도"
              data-testid="reference-strength"
              type="range"
              min="0"
              max="5"
              step="0.1"
              disabled={locked || family !== 'v5'}
              value={reference.strength}
              onChange={(e) =>
                onChange({ ...reference, strength: Number(e.target.value) })
              }
            />
          </label>
          {(reference.role === 'character' ||
            reference.role === 'character-style') && (
            <label htmlFor="reference-outfit">
              <input
                id="reference-outfit"
                type="checkbox"
                disabled={locked || family !== 'v5'}
                checked={reference.preferSameOutfit}
                onChange={(e) =>
                  onChange({ ...reference, preferSameOutfit: e.target.checked })
                }
              />{' '}
              같은 의상 우선
            </label>
          )}
          <p>
            참조는 씬 전체에 적용합니다. 특정 캐릭터 카드와 1:1 대응을 보장하지
            않습니다.
          </p>
          <button
            type="button"
            data-testid="remove-reference"
            disabled={locked}
            onClick={() => onChange(undefined)}
          >
            이번 씬의 참조 해제
          </button>
        </>
      )}
      <p className="connected-reference-cost">{REFERENCE_COST_NOTICE}</p>
    </section>
  );
}

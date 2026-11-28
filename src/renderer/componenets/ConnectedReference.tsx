/* eslint react/require-default-props: ["error", {"functions":"defaultArguments"}], no-void: off -- File selection invokes a bounded asynchronous local operation. */
import { useEffect, useRef, useState } from 'react';
import type { GenerationClient } from '../../workspaceGeneration';
import type {
  ImagePurpose,
  ReferenceAsset,
  WorkspaceReference,
  WorkspaceVariation,
  ReferenceRole,
} from '../../workspaceReference';
import {
  REFERENCE_ROLES,
  REFERENCE_COST_NOTICE,
} from '../../workspaceReference';

interface Props {
  reference: WorkspaceReference | undefined;
  projectId: string | undefined;
  variation: WorkspaceVariation | undefined;
  onVariation: (variation: WorkspaceVariation | undefined) => void;
  sceneId: string;
  family: string;
  locked: boolean;
  preview: { hash: string; bytes: Uint8Array } | undefined;
  client: GenerationClient;
  onFile: (file: File) => Promise<void>;
  onChoose?: () => void;
  onChange: (reference: WorkspaceReference | undefined) => void;
}
function ImagePreview({
  asset,
  purpose,
  projectId,
  sceneId,
  preview,
  client,
}: Pick<Props, 'projectId' | 'sceneId' | 'preview' | 'client'> & {
  asset: ReferenceAsset;
  purpose: ImagePurpose;
}) {
  const [url, setURL] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const hash = asset.uploadHash;
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
        bytes = client.referenceImage(projectId, sceneId, purpose).then((r) => {
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
  }, [projectId, sceneId, hash, preview, client, purpose]);
  const label = purpose === 'img2img' ? '변형 원본' : '레퍼런스';
  return (
    <div>
      {url && <img src={url} alt={`${label} 전송용 미리보기`} />}
      {unavailable && (
        <p role="alert">
          {purpose === 'img2img'
            ? '변형 원본을 읽지 못했습니다. 이미지를 다시 선택하세요.'
            : '참조를 읽지 못했습니다. 다시 선택해 주세요. 참조 없이 자동 생성하지 않습니다.'}
        </p>
      )}
      <small>
        {label} · {asset.width}×{asset.height}
      </small>
    </div>
  );
}

export default function ConnectedReference({
  reference,
  variation,
  onVariation,
  projectId,
  sceneId,
  family,
  locked,
  preview,
  client,
  onFile,
  onChange,
  onChoose = undefined,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
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
        if (!locked && e.dataTransfer.files.length === 1)
          void onFile(e.dataTransfer.files[0]);
      }}
    >
      <header>
        <strong>이미지 입력</strong>
        <small>
          {reference && '참조 1 · +5 Anlas/회'}
          {variation && (reference ? ' · 이미지 변형' : '이미지 변형')}
          {!reference && !variation && '이미지'}
        </small>
      </header>

      <input
        ref={file}
        type="file"
        accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
        hidden
        aria-label="참조로 사용할 이미지"
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
        disabled={locked}
        onClick={() => (onChoose ? onChoose() : file.current?.click())}
      >
        + 이미지 추가
      </button>
      {family !== 'v5' && reference && (
        <p role="status">
          이미지 참조는 V5에서 사용합니다.
          {reference && ' 참조를 해제하거나 V5로 전환해야 생성할 수 있습니다.'}
        </p>
      )}
      {variation && (
        <fieldset disabled={locked}>
          <ImagePreview
            projectId={projectId}
            sceneId={sceneId}
            preview={preview}
            client={client}
            asset={variation}
            purpose="img2img"
          />
          {family !== 'v5' && <p>이미지 변형은 V5에서 사용할 수 있습니다.</p>}
          {(['strength', 'noise'] as const).map((key) => (
            <label key={key} htmlFor={`variation-${key}`}>
              {key === 'strength' ? '변형 강도' : '노이즈'} {variation[key]}
              <input
                id={`variation-${key}`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={variation[key]}
                disabled={family !== 'v5'}
                onChange={(e) =>
                  onVariation({ ...variation, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <button type="button" onClick={() => onVariation(undefined)}>
            변형 해제
          </button>
        </fieldset>
      )}
      {reference && (
        <>
          <ImagePreview
            projectId={projectId}
            sceneId={sceneId}
            preview={preview}
            client={client}
            asset={reference}
            purpose="reference"
          />
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

          <button
            type="button"
            data-testid="remove-reference"
            disabled={locked}
            onClick={() => onChange(undefined)}
          >
            참조 해제
          </button>
        </>
      )}
      {reference && (
        <span
          className="connected-reference-help"
          title={REFERENCE_COST_NOTICE}
        >
          ⓘ 비용 안내
        </span>
      )}
    </section>
  );
}

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
  REFERENCE_ANLAS,
  REFERENCE_ROLES,
  REFERENCE_COST_NOTICE,
  REFERENCE_COUNT_NOTICE,
  REFERENCE_LIMITS,
} from '../../workspaceReference';

interface Props {
  references: WorkspaceReference[];
  projectId: string | undefined;
  variation: WorkspaceVariation | undefined;
  onVariation: (variation: WorkspaceVariation | undefined) => void;
  sceneId: string;
  family: string;
  locked: boolean;
  preview: { hash: string; bytes: Uint8Array } | undefined;
  client: GenerationClient;
  onFile: (file: File) => Promise<void>;
  onChoose: () => void;
  onReplace: (file: File, referenceId: string) => void;
  onChange: (references: WorkspaceReference[]) => void;
  supportsReferences: boolean;
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
        bytes = client
          .referenceImage(
            projectId,
            sceneId,
            purpose,
            purpose === 'reference' ? asset.id : undefined,
          )
          .then((r) => {
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
  }, [projectId, sceneId, hash, preview, client, purpose, asset.id]);
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
  references,
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
  onChoose,
  onReplace,
  supportsReferences,
}: Props) {
  const replacementFile = useRef<HTMLInputElement>(null);
  const replacementId = useRef('');
  const updateReference = (value: WorkspaceReference) =>
    onChange(references.map((r) => (r.id === value.id ? value : r)));
  const move = (from: number, to: number) => {
    const ordered = references.slice();
    ordered.splice(to, 0, ...ordered.splice(from, 1));
    onChange(ordered);
  };
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
          {references.length > 0 &&
            `참조 ${references.length} · +${references.length * REFERENCE_ANLAS} Anlas/회`}
          {variation && (references.length ? ' · 이미지 변형' : '이미지 변형')}
          {!references.length && !variation && '이미지'}
        </small>
      </header>

      <input
        ref={replacementFile}
        type="file"
        accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
        hidden
        aria-label="참조 카드 이미지 교체"
        data-testid="reference-file"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = '';
          if (
            selected &&
            !locked &&
            supportsReferences &&
            references.some((r) => r.id === replacementId.current)
          ) {
            onReplace(selected, replacementId.current);
          }
        }}
      />
      <button
        type="button"
        data-testid="choose-reference"
        disabled={locked}
        onClick={onChoose}
      >
        + 이미지 추가
      </button>
      {!supportsReferences && !!references.length && (
        <p role="status">
          참조를 해제하거나 V5 Full · High 또는 Curated로 전환해야 생성할 수
          있습니다.
        </p>
      )}
      {references.length >= REFERENCE_LIMITS.cards && (
        <small>{REFERENCE_COUNT_NOTICE}</small>
      )}
      {new Set(references.map((r) => r.uploadHash)).size <
        references.length && (
        <small>
          같은 이미지가 여러 카드에 있습니다. 각 카드는 참조 추가분에
          포함됩니다.
        </small>
      )}
      {supportsReferences && !!references.length && (
        <small>
          배경 사진의 색감과 화풍은 ‘화풍’으로 참조하고, 장소와 구도는 기본
          프롬프트에 적어 주세요.
        </small>
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
      {references.map((reference, index) => {
        const control = (name: string) =>
          index === 0 ? name : `${name}-${index + 1}`;
        return (
          <fieldset
            key={reference.id}
            className="connected-reference-card"
            data-testid="reference-card"
            data-reference-id={reference.id}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (
                !locked &&
                supportsReferences &&
                e.dataTransfer.files.length === 1
              )
                onReplace(e.dataTransfer.files[0], reference.id);
            }}
          >
            <legend>참조 {index + 1}</legend>
            <ImagePreview
              projectId={projectId}
              sceneId={sceneId}
              preview={preview}
              client={client}
              asset={reference}
              purpose="reference"
            />
            <label htmlFor={control('reference-role')}>
              참조 대상
              <select
                id={control('reference-role')}
                aria-label="참조 대상"
                data-testid={control('reference-role')}
                disabled={locked || !supportsReferences}
                value={reference.role}
                onChange={(e) => {
                  const role = e.target.value as ReferenceRole;
                  updateReference({
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
            <label htmlFor={control('reference-strength')}>
              강도 {reference.strength}
              <input
                id={control('reference-strength')}
                aria-label="참조 강도"
                data-testid={control('reference-strength')}
                type="range"
                min="0"
                max="5"
                step="0.1"
                disabled={locked || !supportsReferences}
                value={reference.strength}
                onChange={(e) =>
                  updateReference({
                    ...reference,
                    strength: Number(e.target.value),
                  })
                }
              />
            </label>
            {(reference.role === 'character' ||
              reference.role === 'character-style') && (
              <label htmlFor={control('reference-outfit')}>
                <input
                  id={control('reference-outfit')}
                  type="checkbox"
                  disabled={locked || !supportsReferences}
                  checked={reference.preferSameOutfit}
                  onChange={(e) =>
                    updateReference({
                      ...reference,
                      preferSameOutfit: e.target.checked,
                    })
                  }
                />{' '}
                같은 의상 우선
              </label>
            )}

            <div className="connected-reference-actions">
              <button
                type="button"
                disabled={locked || !supportsReferences}
                onClick={() => {
                  replacementId.current = reference.id;
                  replacementFile.current?.click();
                }}
              >
                이미지 교체
              </button>
              {references.length > 1 && (
                <>
                  <button
                    type="button"
                    disabled={locked || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    앞으로
                  </button>
                  <button
                    type="button"
                    disabled={locked || index === references.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    뒤로
                  </button>
                </>
              )}
              <button
                type="button"
                data-testid={control('remove-reference')}
                disabled={locked}
                onClick={() =>
                  onChange(references.filter((r) => r.id !== reference.id))
                }
              >
                참조 해제
              </button>
            </div>
          </fieldset>
        );
      })}
      {!!references.length && (
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

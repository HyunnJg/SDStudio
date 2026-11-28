/* eslint react/require-default-props: off, jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState } from 'react';
import type {
  WorkspaceDraft,
  WorkspaceCharacter,
} from '../preview/workspaceDraft';
import { moveWorkspaceCharacter } from '../preview/workspaceDraft';
import { characterLimit } from '../../workspaceCatalog';
import { PROJECT_LIMITS } from '../../workspaceProject';
import { hasActiveCharacterPrompt } from '../../workspaceCharacterInput';

interface Props {
  draft: WorkspaceDraft;
  onChange: (patch: Partial<WorkspaceDraft>) => void;
  onPreset?: (id?: string) => void;
  presetLabels?: Record<string, string>;
  presetCount?: number;
}

export default function ConnectedCharacters({
  draft,
  onChange,
  onPreset,
  presetLabels = {},
  presetCount = 0,
}: Props) {
  const [removed, setRemoved] = useState<{
    character: WorkspaceCharacter;
    index: number;
  }>();
  const { characters } = draft;
  const active = characters.filter(hasActiveCharacterPrompt).length;
  const waiting = characters.filter(
    (c) => c.enabled && !hasActiveCharacterPrompt(c),
  ).length;
  const limit = characterLimit(draft);
  const supported = limit > 0;
  const update = (id: string, patch: Partial<WorkspaceCharacter>) =>
    onChange({
      characters: characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  return (
    <section
      className="connected-characters"
      aria-label="캐릭터 프롬프트"
      data-testid="live-characters"
    >
      <h3>
        캐릭터 프롬프트{' '}
        <small className={active > limit ? 'connected-character-overflow' : ''}>
          생성 {active}/{limit}
          {waiting > 0 && ` · 작성 대기 ${waiting}`}
        </small>
      </h3>
      {onPreset && (
        <button type="button" onClick={() => onPreset()}>
          캐릭터 프리셋 {presetCount}
        </button>
      )}
      {active > limit && (
        <p
          role="alert"
          className="connected-character-overflow"
          data-testid="character-limit-warning"
        >
          생성 대상이 {limit}명을 넘었습니다. 일부 캐릭터를 꺼 주세요. 입력은
          보관됩니다.
        </p>
      )}
      <p>
        기본 프롬프트에는 인원수·배경·화풍을, 아래에는 각 캐릭터의 특징을
        적으세요. 배치는 위에서 아래로 적힌 순서를 참고합니다. 빈 카드는
        보관하고 생성에는 사용하지 않습니다.
      </p>

      {!supported && (
        <div role="status">
          <p>
            현재 모델은 캐릭터 입력을 사용할 수 없습니다. 모델을 바꾸거나 조건을
            꺼 주세요. 입력은 보존됩니다.
          </p>
          {characters.some((c) => c.enabled) && (
            <button
              type="button"
              data-testid="disable-live-characters"
              onClick={() =>
                onChange({
                  characters: characters.map((c) => ({ ...c, enabled: false })),
                })
              }
            >
              캐릭터 조건 끄기
            </button>
          )}
        </div>
      )}
      {supported && active > 0 && draft.placement === 'manual' && (
        <div role="status">
          <p>
            수동 위치 초안이 남아 있습니다. 이번 생성은 자동 배치로
            전환해주세요.
          </p>
          <button
            type="button"
            onClick={() => onChange({ placement: 'auto' })}
            data-testid="live-auto-placement"
          >
            자동 배치로 전환
          </button>
        </div>
      )}
      <fieldset disabled={!supported}>
        {characters.map((c, index) => {
          const promptId = `live-character-${c.id}-prompt`;
          const negativeId = `live-character-${c.id}-negative`;
          return (
            <article
              key={c.id}
              className="connected-character"
              data-character-id={c.id}
            >
              <header>
                <label>
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    data-character-enabled={c.id}
                    disabled={
                      !c.enabled && !!c.prompt.trim() && active >= limit
                    }
                    onChange={(e) =>
                      update(c.id, { enabled: e.target.checked })
                    }
                  />
                  캐릭터 {index + 1}
                </label>
                <div className="connected-character-actions">
                  <button
                    type="button"
                    aria-label={`캐릭터 ${index + 1} 위로`}
                    disabled={index === 0}
                    data-character-up={c.id}
                    onClick={() =>
                      onChange({
                        characters: moveWorkspaceCharacter(
                          characters,
                          c.id,
                          -1,
                        ),
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`캐릭터 ${index + 1} 아래로`}
                    disabled={index === characters.length - 1}
                    data-character-down={c.id}
                    onClick={() =>
                      onChange({
                        characters: moveWorkspaceCharacter(characters, c.id, 1),
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`캐릭터 ${index + 1} 삭제`}
                    data-character-delete={c.id}
                    onClick={() => {
                      setRemoved({ character: structuredClone(c), index });
                      onChange({
                        characters: characters.filter(
                          (item) => item.id !== c.id,
                        ),
                      });
                    }}
                  >
                    삭제
                  </button>
                </div>
              </header>
              {onPreset && (
                <button
                  type="button"
                  data-character-preset={c.id}
                  onClick={() => onPreset(c.id)}
                >
                  {presetLabels[c.id] || '프리셋 선택'}
                </button>
              )}
              <label htmlFor={promptId}>캐릭터 프롬프트</label>
              <textarea
                id={promptId}
                rows={3}
                value={c.prompt}
                data-character-prompt={c.id}
                onChange={(e) => update(c.id, { prompt: e.target.value })}
              />
              <details className="connected-character-negative">
                <summary>
                  부정 프롬프트{c.negativePrompt ? ' · 입력됨' : ''}
                </summary>
                <label className="connected-sr-only" htmlFor={negativeId}>
                  캐릭터 부정 프롬프트
                </label>
                <textarea
                  id={negativeId}
                  rows={2}
                  value={c.negativePrompt}
                  data-character-negative={c.id}
                  onChange={(e) =>
                    update(c.id, { negativePrompt: e.target.value })
                  }
                />
              </details>
              {c.enabled && !hasActiveCharacterPrompt(c) && (
                <span
                  className="connected-character-muted"
                  data-character-waiting={c.id}
                >
                  작성 대기 · 캐릭터 프롬프트를 입력하면 생성에 포함합니다.
                  {c.negativePrompt.trim() &&
                    ' 부정 입력도 보관만 하고 아직 전송하지 않습니다.'}
                </span>
              )}
              {!c.enabled && (
                <span className="connected-character-muted">
                  비활성 · 입력은 보관하고 생성에는 사용하지 않습니다.
                </span>
              )}
            </article>
          );
        })}
        <button
          type="button"
          data-testid="add-live-character"
          disabled={
            active >= limit || characters.length >= PROJECT_LIMITS.characters
          }
          onClick={() =>
            onChange({
              characters: [
                ...characters,
                {
                  id: crypto.randomUUID(),
                  enabled: true,
                  prompt: '',
                  negativePrompt: '',
                  cell: { row: 2, column: 2 },
                },
              ],
            })
          }
        >
          + 캐릭터 추가
        </button>
        {removed && (
          <button
            type="button"
            data-testid="undo-live-character"
            disabled={
              characters.length >= PROJECT_LIMITS.characters ||
              characters.some((c) => c.id === removed.character.id) ||
              (hasActiveCharacterPrompt(removed.character) && active >= limit)
            }
            onClick={() => {
              const next = [...characters];
              next.splice(removed.index, 0, removed.character);
              onChange({ characters: next });
              setRemoved(undefined);
            }}
          >
            마지막 캐릭터 삭제 취소
          </button>
        )}
      </fieldset>
    </section>
  );
}

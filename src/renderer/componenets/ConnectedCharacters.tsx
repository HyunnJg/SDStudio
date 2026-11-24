/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState } from 'react';
import type {
  WorkspaceDraft,
  WorkspaceCharacter,
} from '../preview/workspaceDraft';
import { moveWorkspaceCharacter } from '../preview/workspaceDraft';
import { V5_CHARACTER_LIMIT } from '../../workspaceGenerationSettings';
import { PROJECT_LIMITS } from '../../workspaceProject';

interface Props {
  draft: WorkspaceDraft;
  onChange: (patch: Partial<WorkspaceDraft>) => void;
}

export default function ConnectedCharacters({ draft, onChange }: Props) {
  const [removed, setRemoved] = useState<{
    character: WorkspaceCharacter;
    index: number;
  }>();
  const { characters } = draft;
  const active = characters.filter((c) => c.enabled).length;
  const v5 = draft.family === 'v5';
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
        <small>
          {active}/{V5_CHARACTER_LIMIT}
        </small>
      </h3>
      <p>
        기본 프롬프트에는 인원수·배경·화풍을, 아래에는 각 캐릭터의 특징을
        적으세요. 배치는 위에서 아래로 적힌 순서를 참고합니다.
      </p>

      {!v5 && (
        <div role="status">
          <p>
            이 앱의 V4.5 생성 경로에서는 캐릭터 조건을 지원하지 않습니다. V5
            Full로 바꾸거나 조건을 꺼 주세요. 입력은 보존됩니다.
          </p>
          {active > 0 && (
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
      {v5 && draft.placement === 'manual' && (
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
      <fieldset disabled={!v5}>
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
                    disabled={!c.enabled && active >= V5_CHARACTER_LIMIT}
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
            active >= V5_CHARACTER_LIMIT ||
            characters.length >= PROJECT_LIMITS.characters
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
              (removed.character.enabled && active >= V5_CHARACTER_LIMIT)
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

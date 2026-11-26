/* eslint react/require-default-props: off, jsx-a11y/label-has-associated-control: ["error", {"assert":"either"}], no-void: off */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresetUse } from '../generation/presetPresentation';
import type { WorkspaceDraft } from '../preview/workspaceDraft';
import type {
  LibraryClient,
  LibraryReply,
  LibrarySnapshot,
  PresetContent,
  PresetKind,
  PromptPreset,
  PresetApplication,
} from '../../promptLibrary';
import {
  applyPromptPreset,
  presetFromDraft,
  inspectLegacyPresets,
  hasLegacyPromptSyntax,
  LIBRARY_LIMITS,
  LibraryError,
} from '../../promptLibrary';

interface Props {
  client: LibraryClient;
  draft: WorkspaceDraft;
  kind: PresetKind;
  characterId?: string;
  locked: boolean;
  onApply: (
    draft: WorkspaceDraft,
    characterId?: string,
    preset?: PresetUse,
  ) => void;
  initialId?: string;
  onLibraryChange?: (snapshot: LibrarySnapshot) => void;
  onClose: () => void;
  onGuard: (blocked: boolean) => void;
  onLegacy: () => void;
}
const contentOf = (p: PresetContent): PresetContent => ({
  kind: p.kind,
  name: p.name,
  prompt: p.prompt,
  negativePrompt: p.negativePrompt,
  ...(p.kind === 'main'
    ? { qualityTags: p.qualityTags, ucPreset: p.ucPreset }
    : {}),
});
const messages = {
  LIBRARY_INPUT: '이름과 입력·적용 항목을 확인해 주세요.',
  LIBRARY_LIMIT:
    '보관 한도(휴지통 포함200개·전체2MiB) 또는 텍스트 길이를 확인해 주세요.',
  LIBRARY_CONFLICT:
    '라이브러리가 변경됐습니다. 편집 내용을 확인한 뒤 새로고침하세요.',
  LIBRARY_CORRUPT:
    '라이브러리 파일을 읽지 못했습니다. 원본을 보존하고 덮어쓰지 않았습니다.',
  LIBRARY_VERSION: '이 앱보다 새로운 라이브러리입니다. 원본을 유지합니다.',
  LIBRARY_IO:
    '읽기·저장 결과를 확인하지 못했습니다. 새로고침 후 목록을 확인하세요.',
  LIBRARY_UNTRUSTED: '이 화면에서 라이브러리를 사용할 수 없습니다.',
};
export default function PromptLibrary({
  client,
  draft,
  kind,
  characterId,
  locked,
  onApply,
  onClose,
  onGuard,
  onLegacy,
  initialId,
  onLibraryChange,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>();
  const [editor, setEditor] = useState<PresetContent>(() =>
    presetFromDraft(draft, kind, characterId),
  );
  const [editorId, setEditorId] = useState<string>();
  const [baseline, setBaseline] = useState(() => JSON.stringify(editor));
  const [filter, setFilter] = useState<PresetKind>(kind);
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<() => void>();
  const [purgeConfirmed, setPurgeConfirmed] = useState(false);
  const [candidates, setCandidates] = useState<
    { id: string; content: PresetContent }[]
  >([]);
  const [options, setOptions] = useState<PresetApplication>({
    mode: 'replace',
    prompt: true,
    negative: true,
    presets: true,
    characterId,
  });
  const [undo, setUndo] = useState<{ before: WorkspaceDraft; after: string }>();
  const alive = useRef(true);
  const guard = useRef(onGuard);
  guard.current = onGuard;
  const epoch = useRef(0);
  const dirty = JSON.stringify(editor) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const selected = snapshot?.entries.find((p) => p.id === editorId);
  const blocked = locked || working || !!confirm;
  useEffect(() => {
    guard.current(working || dirty);
  }, [working, dirty]);
  const fail = useCallback(
    (error: unknown) =>
      setMessage(
        messages[
          (error as { code?: keyof typeof messages })?.code ?? 'LIBRARY_IO'
        ] ?? messages.LIBRARY_IO,
      ),
    [],
  );
  const invoke = useCallback(
    async (
      action: () => Promise<LibraryReply>,
      accept?: (value: LibrarySnapshot) => void,
    ) => {
      const generation = epoch.current;
      guard.current(true);
      setWorking(true);
      setMessage('');
      try {
        const reply = await action();
        if (!alive.current || generation !== epoch.current) return;
        if (!reply.ok) {
          fail(reply);
          return;
        }
        setSnapshot(reply.value);
        onLibraryChange?.(reply.value);
        accept?.(reply.value);
      } catch (error) {
        if (alive.current && generation === epoch.current) fail(error);
      } finally {
        if (alive.current && generation === epoch.current) {
          setWorking(false);
          guard.current(dirtyRef.current);
        }
      }
    },
    [fail, onLibraryChange],
  );
  useEffect(() => {
    alive.current = true;
    epoch.current += 1;
    dialog.current?.showModal();
    void invoke(
      () => client.read(),
      (value) => {
        const entry = value.entries.find(
          (item) => item.id === initialId && !item.deleted,
        );
        if (entry) {
          const content = contentOf(entry);
          setEditor(content);
          setBaseline(JSON.stringify(content));
          setEditorId(entry.id);
          setFilter(entry.kind);
        }
      },
    );
    return () => {
      alive.current = false;
      epoch.current += 1;
      guard.current(false);
    };
  }, [client, invoke, initialId]);
  const openEditor = (content: PresetContent, id?: string) => {
    const value = contentOf(content);
    setEditor(value);
    setBaseline(JSON.stringify(value));
    setEditorId(id);
    setFilter(value.kind);
    setPurgeConfirmed(false);
    setMessage('');
  };
  const leave = (action: () => void) => {
    if (working) return;
    if (dirty) setConfirm(() => action);
    else action();
  };
  const loadEntry = (entry: PromptPreset) =>
    leave(() => openEditor(entry, entry.id));
  let preview: WorkspaceDraft | undefined;
  try {
    if (!selected?.deleted)
      preview = applyPromptPreset(
        draft,
        editor,
        options,
        () => 'preview-character',
      );
  } catch {
    /* Invalid/unnamed editor remains editable. */
  }
  const patch = (value: Partial<PresetContent>) => {
    guard.current(JSON.stringify({ ...editor, ...value }) !== baseline);
    setEditor((previous) => ({ ...previous, ...value }));
  };
  const save = () => {
    if (!snapshot) return;
    void invoke(
      () => client.save(snapshot.revision, editor, editorId),
      (value) => {
        const entry = editorId
          ? value.entries.find((p) => p.id === editorId)
          : value.entries.at(-1);
        if (entry) openEditor(entry, entry.id);
        setMessage('');
      },
    );
  };
  const deleted = (value: boolean) => {
    if (!snapshot || !editorId) return;
    void invoke(
      () => client.setDeleted(snapshot.revision, editorId, value),
      (s) => {
        const entry = s.entries.find((p) => p.id === editorId);
        if (entry) openEditor(entry, entry.id);
        setMessage('');
      },
    );
  };
  const readLegacy = async (file: File) => {
    guard.current(true);
    setWorking(true);
    setMessage('');
    try {
      if (file.size > LIBRARY_LIMITS.bytes)
        throw new LibraryError('LIBRARY_LIMIT');
      const bytes = await file.arrayBuffer();
      if (!alive.current) return;
      if (bytes.byteLength > LIBRARY_LIMITS.bytes)
        throw new LibraryError('LIBRARY_LIMIT');
      const imported = inspectLegacyPresets(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      const values = imported.candidates;
      setCandidates(
        values.map((content) => ({ id: crypto.randomUUID(), content })),
      );
      setMessage(
        (imported.skipped
          ? `${imported.skipped}개는 이름·길이·텍스트 형식 문제로 제외했습니다. `
          : '') +
          (values.length
            ? '가져올 후보를 선택한 뒤 이름·텍스트를 확인하고 저장하세요. 원본 파일은 바꾸지 않습니다.'
            : '지원하는 V3 SDImageGen/SDImageGenEasy 프리셋을 찾지 못했습니다.'),
      );
    } catch (error) {
      if (alive.current)
        fail(error instanceof LibraryError ? error : { code: 'LIBRARY_INPUT' });
    } finally {
      if (alive.current) {
        setWorking(false);
        guard.current(dirtyRef.current);
      }
    }
  };
  let saveState = '새 프리셋';
  if (editorId) saveState = '✓ 저장됨';
  if (selected?.deleted) saveState = '휴지통';
  if (dirty) saveState = '● 편집 중';
  if (working) saveState = '◌';
  return (
    <dialog
      ref={dialog}
      className="prompt-library-dialog"
      aria-label="프롬프트 라이브러리"
      data-testid="prompt-library"
      onCancel={(e) => {
        e.preventDefault();
        leave(onClose);
      }}
    >
      <header>
        <h2>프롬프트 라이브러리</h2>
        <button
          type="button"
          disabled={working}
          data-testid="library-close"
          onClick={() => leave(onClose)}
        >
          닫기
        </button>
      </header>
      <div className="library-state" data-testid="library-save-state">
        {saveState}
      </div>
      {confirm && (
        <section role="alert" className="library-confirm">
          저장하지 않은 프리셋 편집을 버리고 계속할까요?
          <button type="button" onClick={() => setConfirm(undefined)}>
            계속 편집
          </button>
          <button
            type="button"
            data-testid="library-discard-edit"
            onClick={() => {
              const action = confirm;
              setConfirm(undefined);
              action();
            }}
          >
            버리고 계속
          </button>
        </section>
      )}
      {message && (
        <p role="status" data-testid="library-status">
          {message}
        </p>
      )}
      <div className="library-columns">
        <aside>
          <fieldset disabled={blocked}>
            <legend>찾기</legend>
            <label>
              종류
              <select
                aria-label="프리셋 종류"
                value={filter}
                onChange={(e) => setFilter(e.target.value as PresetKind)}
              >
                <option value="main">메인</option>
                <option value="character">캐릭터</option>
              </select>
            </label>
            <label>
              검색
              <input
                aria-label="프리셋 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={trash}
                data-testid="library-trash"
                onChange={(e) => {
                  const { checked } = e.target;
                  leave(() => {
                    setTrash(checked);
                    openEditor(
                      presetFromDraft(draft, filter, options.characterId),
                    );
                  });
                }}
              />
              휴지통
            </label>
            <button
              type="button"
              data-testid="library-new"
              onClick={() =>
                leave(() => {
                  setTrash(false);
                  openEditor(
                    presetFromDraft(draft, filter, options.characterId),
                  );
                })
              }
            >
              현재 입력으로 새 프리셋
            </button>
            <button
              type="button"
              onClick={() =>
                leave(() => {
                  void invoke(
                    () => client.read(),
                    () =>
                      openEditor(
                        presetFromDraft(draft, filter, options.characterId),
                      ),
                  );
                })
              }
            >
              새로고침
            </button>
          </fieldset>
          <p className="library-count" data-testid="library-count">
            메인{' '}
            {snapshot?.entries.filter((p) => !p.deleted && p.kind === 'main')
              .length ?? 0}{' '}
            · 캐릭터{' '}
            {snapshot?.entries.filter(
              (p) => !p.deleted && p.kind === 'character',
            ).length ?? 0}
            {trash &&
              ` · 휴지통 ${snapshot?.entries.filter((p) => p.deleted).length ?? 0}`}
          </p>
          <ul className="library-list">
            {snapshot?.entries
              .slice()
              .reverse()
              .filter(
                (p) =>
                  p.kind === filter &&
                  p.deleted === trash &&
                  p.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={blocked}
                    aria-pressed={p.id === editorId}
                    data-library-entry={p.id}
                    onClick={() => loadEntry(p)}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
          </ul>
        </aside>
        <section className="library-editor">
          <h3>
            {editor.kind === 'main' ? '메인 프리셋' : '캐릭터 프리셋'}
            {dirty ? ' · 수정됨' : ''}
          </h3>
          <fieldset disabled={blocked || selected?.deleted}>
            <legend>프리셋 편집</legend>
            <label>
              이름
              <input
                data-testid="library-name"
                maxLength={120}
                value={editor.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              프롬프트
              <textarea
                data-testid="library-prompt"
                rows={6}
                maxLength={LIBRARY_LIMITS.text}
                value={editor.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
            </label>
            <label>
              부정 프롬프트
              <textarea
                data-testid="library-negative"
                rows={4}
                maxLength={LIBRARY_LIMITS.text}
                value={editor.negativePrompt}
                onChange={(e) => patch({ negativePrompt: e.target.value })}
              />
            </label>
            {editor.kind === 'main' && (
              <div className="library-preset-settings">
                <label>
                  품질 자동 추가
                  <select
                    value={editor.qualityTags}
                    onChange={(e) =>
                      patch({
                        qualityTags: e.target
                          .value as WorkspaceDraft['qualityTags'],
                      })
                    }
                  >
                    <option value="none">없음</option>
                    <option value="light">Light</option>
                    <option value="standard">Standard</option>
                  </select>
                </label>
                <label>
                  UC 자동 추가
                  <select
                    value={editor.ucPreset}
                    onChange={(e) =>
                      patch({
                        ucPreset: e.target.value as WorkspaceDraft['ucPreset'],
                      })
                    }
                  >
                    {['none', 'light', 'heavy', 'human', 'furry'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <button
              type="button"
              disabled={!snapshot || !editor.name.trim()}
              data-testid="library-save"
              onClick={save}
            >
              라이브러리에 저장
            </button>
            {editorId && (
              <button
                type="button"
                data-testid="library-delete"
                onClick={() => leave(() => deleted(true))}
              >
                휴지통으로
              </button>
            )}
          </fieldset>
          {selected?.deleted && (
            <fieldset disabled={blocked}>
              <legend>휴지통 항목</legend>
              <button
                type="button"
                data-testid="library-restore"
                onClick={() => deleted(false)}
              >
                복원
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={purgeConfirmed}
                  onChange={(e) => setPurgeConfirmed(e.target.checked)}
                />
                이 항목을 영구 삭제합니다.
              </label>
              <button
                type="button"
                disabled={!purgeConfirmed}
                onClick={() => {
                  if (snapshot && editorId)
                    void invoke(
                      () => client.remove(snapshot.revision, editorId),
                      () =>
                        openEditor(
                          presetFromDraft(draft, filter, options.characterId),
                        ),
                    );
                }}
              >
                영구 삭제
              </button>
            </fieldset>
          )}
          {!selected?.deleted && (
            <fieldset disabled={blocked}>
              <legend>작업실에 적용</legend>
              {editor.kind === 'character' && (
                <label>
                  적용할 캐릭터
                  <select
                    value={options.characterId ?? ''}
                    data-testid="library-character-target"
                    onChange={(e) =>
                      setOptions((p) => ({
                        ...p,
                        characterId: e.target.value || undefined,
                      }))
                    }
                  >
                    <option value="">새 캐릭터로 추가</option>
                    {draft.characters.map((c, i) => (
                      <option key={c.id} value={c.id}>
                        캐릭터 {i + 1} · {c.prompt.slice(0, 24) || '작성 대기'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                방식
                <select
                  data-testid="library-mode"
                  value={options.mode}
                  onChange={(e) =>
                    setOptions((p) => ({
                      ...p,
                      mode: e.target.value as PresetApplication['mode'],
                      presets: false,
                    }))
                  }
                >
                  <option value="replace">교체</option>
                  <option value="append">덧붙이기 · 줄바꿈으로 연결</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.prompt}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, prompt: e.target.checked }))
                  }
                />
                프롬프트 적용
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.negative}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, negative: e.target.checked }))
                  }
                />
                부정 적용
              </label>
              {editor.kind === 'main' && (
                <label>
                  <input
                    type="checkbox"
                    data-testid="library-apply-presets"
                    checked={options.presets}
                    onChange={(e) =>
                      setOptions((p) => ({ ...p, presets: e.target.checked }))
                    }
                  />
                  품질·UC도 적용 ({editor.qualityTags}/{editor.ucPreset})
                </label>
              )}
              {editor.kind === 'main' && !options.presets && (
                <p>
                  현재 품질·UC 선택을 유지합니다. PNG 최종 태그가 포함된
                  텍스트는 자동 추가가 중복되지 않는지 확인하세요.
                </p>
              )}
              {editor.kind === 'main' && (
                <p>
                  현재 자동 추가: 품질 {draft.qualityTags ?? 'none'} / UC{' '}
                  {draft.ucPreset ?? 'none'}. 프리셋 선택: {editor.qualityTags}{' '}
                  / {editor.ucPreset}.
                </p>
              )}
              <details>
                <summary>적용 결과 미리보기</summary>
                {preview ? (
                  <>
                    <pre>
                      {editor.kind === 'main'
                        ? preview.prompt
                        : (preview.characters.find(
                            (c) => c.id === options.characterId,
                          )?.prompt ?? preview.characters.at(-1)?.prompt)}
                    </pre>
                    <pre>
                      부정:{' '}
                      {editor.kind === 'main'
                        ? preview.negativePrompt
                        : (preview.characters.find(
                            (c) => c.id === options.characterId,
                          )?.negativePrompt ??
                          preview.characters.at(-1)?.negativePrompt)}
                    </pre>
                  </>
                ) : (
                  <p>
                    이름과 적용 항목·대상을 확인하세요. V4.5에서는 품질/UC 자동
                    추가 없음만 적용할 수 있습니다.
                  </p>
                )}
              </details>
              <button
                type="button"
                data-testid="library-apply"
                disabled={!preview}
                onClick={() => {
                  try {
                    const value = applyPromptPreset(draft, editor, options);
                    setUndo({
                      before: structuredClone(draft),
                      after: JSON.stringify(value),
                    });
                    onApply(
                      value,
                      editor.kind === 'character'
                        ? (options.characterId ?? value.characters.at(-1)?.id)
                        : undefined,
                      {
                        name: dirty ? `${editor.name} · 편집본` : editor.name,
                        kind: editor.kind,
                        id: dirty ? undefined : editorId,
                        characterId:
                          editor.kind === 'character'
                            ? (options.characterId ??
                              value.characters.at(-1)?.id)
                            : undefined,
                        mode: options.mode,
                      },
                    );
                    setMessage('');
                  } catch (error) {
                    fail(error);
                  }
                }}
              >
                선택한 항목 적용
              </button>
              <button
                type="button"
                disabled={!undo || undo.after !== JSON.stringify(draft)}
                data-testid="library-undo"
                onClick={() => {
                  if (undo) {
                    onApply(undo.before);
                    setUndo(undefined);
                  }
                }}
              >
                입력 적용 되돌리기
              </button>
            </fieldset>
          )}
        </section>
      </div>
      <details>
        <summary>기존 V3에서 가져오기·도구</summary>
        <p>
          내보낸 V3 세션 JSON에서 SDImageGen/SDImageGenEasy의 상위·하위·부정
          텍스트와 Easy 공유 캐릭터·배경을 읽습니다. 공유 부정은 메인 후보로
          분리합니다. 씬 중간 입력·모델·생성 설정·이미지는 가져오지 않습니다.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          aria-label="기존 V3 세션 JSON"
          disabled={blocked}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void readLegacy(file);
          }}
        />
        {candidates.map(({ id, content: p }) => (
          <button
            type="button"
            key={id}
            disabled={blocked}
            onClick={() => leave(() => openEditor(p))}
          >
            {p.name} · 초안 열기
            {hasLegacyPromptSyntax(p) && (
              <small>
                {' '}
                · V3 조각은 작업실에서 모음 JSON을 가져오세요. 단독 | 교차
                문법은 직접 편집하세요.
              </small>
            )}
          </button>
        ))}
        <p>
          저장해 둔 V3 프롬프트 조각을 열 수 있습니다. 기존 데이터는 유지합니다.
        </p>
        <button
          type="button"
          disabled={working || locked}
          onClick={() =>
            leave(() => {
              onClose();
              onLegacy();
            })
          }
        >
          V3 프롬프트 조각 열기
        </button>
      </details>
    </dialog>
  );
}

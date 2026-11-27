/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useEffect, useRef, useState } from 'react';
import legacyMaskEntries from '../../legacyMaskEntries';
import type { Session } from '../models/types';
import { inspectLegacyPresets } from '../../promptLibrary';
import type { LegacyPresetImport } from '../../promptLibrary';
import { backend, sessionService } from '../models';
import { inspectPieceImport, validPieces } from '../../workspacePromptPieces';
import type { PromptPiece } from '../../workspacePromptPieces';
import { PROJECT_LIMITS } from '../../workspaceProject';
import { REFERENCE_LIMITS } from '../../workspaceReference';

const safeName = (name: string) =>
  !!name &&
  name !== '.' &&
  name !== '..' &&
  !/[\\/:*?"<>|]/.test(name) &&
  !/[. ]$/.test(name);

function dictionary(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Reading assets for the new workspace must never register a V3 session for autosave or migration.
function readImportIndex(name: string, value: unknown) {
  const data = dictionary(value);
  const images = ['scenes', 'inpaints'].flatMap((group) =>
    Object.entries(dictionary(data[group])).flatMap(([key, item]) => {
      const row = dictionary(item);
      const scene = typeof row.name === 'string' && row.name ? row.name : key;
      const type = group === 'inpaints' ? 'inpaint' : 'scene';
      const files =
        type === 'inpaint' ? row.imageMap : (row.mains ?? [row.main]);
      if (!safeName(scene) || !Array.isArray(files)) return [];
      return files
        .filter(
          (file): file is string =>
            typeof file === 'string' &&
            safeName(file) &&
            file.toLowerCase().endsWith('.png'),
        )
        .map((file) => ({
          scene: { name: scene, type },
          name: file,
          id: JSON.stringify([type, scene, file]),
          path: `${type === 'inpaint' ? 'inpaints' : 'outs'}/${name}/${scene}/${file}`,
        }));
    }),
  );
  return {
    name,
    scenes: Object.entries(dictionary(data.scenes)).map(([key, scene]) => {
      const row = dictionary(scene);
      const count = Array.isArray(row.slots)
        ? row.slots.reduce(
            (n: number, slot: unknown) =>
              Array.isArray(slot)
                ? n * slot.filter((v) => dictionary(v).enabled !== false).length
                : 0,
            1,
          )
        : 0;
      return {
        key,
        name: typeof row.name === 'string' ? row.name : key,
        count,
        picks: Array.isArray(row.mains)
          ? new Set(row.mains).size
          : Number(!!row.main),
      };
    }),
    maskScenes: legacyMaskEntries(dictionary(data.inpaints), data.version).map(
      ({ key, label }) => ({ key, name: label }),
    ),
    images,
    presetSource: { presets: data.presets, presetShareds: data.presetShareds },
    library: new Map(Object.entries(dictionary(data.library))),
  };
}

export default function LegacyWorkspaceImport({
  session: currentSession,
  pieces,
  onPieces,
  onImage,
  onCopyScene,
  onCopyMasks,
  onPresets,
  onClose,
  disabled,
}: {
  session: Session | undefined;
  pieces: PromptPiece[];
  onPieces: (value: PromptPiece[]) => void;
  onImage: (file: File) => void;
  onPresets: (value: LegacyPresetImport) => void;
  onCopyScene: (name: string, key: string, withPicks: boolean) => void;
  onCopyMasks: (name: string, selected: string[]) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [session, setSession] = useState<
    ReturnType<typeof readImportIndex> | undefined
  >(
    () =>
      currentSession && {
        ...readImportIndex(currentSession.name, currentSession.toJSON()),
        scenes: [],
        maskScenes: [],
      },
  );
  const [names, setNames] = useState(() => sessionService.list());
  useEffect(() => {
    const update = () => setNames([...sessionService.list()]);
    sessionService.addEventListener('listupdated', update);
    return () => sessionService.removeEventListener('listupdated', update);
  }, []);
  const modal = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const [sceneKey, setSceneKey] = useState('');
  const [withPicks, setWithPicks] = useState(true);
  const ordinary = session?.scenes.find((s) => s.key === sceneKey);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [library, setLibrary] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    active.current = true;
    const dialog = modal.current;
    dialog?.showModal();
    return () => {
      active.current = false;
      dialog?.close();
    };
  }, []);
  // Project copies read the last disk save. Pieces and presets may come from the open editor.
  const savedName = session?.name;
  const currentName = currentSession?.name;
  useEffect(() => {
    if (
      !savedName ||
      savedName !== currentName ||
      !safeName(savedName) ||
      !names.includes(savedName)
    )
      return undefined;
    let live = true;
    backend
      .readFile(`projects/${savedName}.json`)
      .then((text) => {
        const saved = readImportIndex(savedName, JSON.parse(text));
        if (live) {
          setExcluded([]);
          setSession((previous) =>
            previous?.name === savedName
              ? {
                  ...previous,
                  scenes: saved.scenes,
                  maskScenes: saved.maskScenes,
                }
              : previous,
          );
        }
        return undefined;
      })
      .catch(() => {
        if (live) setMessage('저장된 씬 목록을 읽을 수 없습니다.');
      });
    return () => {
      live = false;
    };
  }, [savedName, currentName, names]);
  const images = session?.images ?? [];
  const importImage = async () => {
    const item = images.find((i) => i.id === selected);
    if (
      !session ||
      !item ||
      ![session.name, item.scene.name, item.name].every(safeName)
    ) {
      setMessage('이미지 이름을 확인하세요.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const uri = await backend.readDataFile(item.path);
      if (!active.current) return;
      if (
        !uri ||
        !uri.startsWith('data:image/png;base64,') ||
        uri.length > (REFERENCE_LIMITS.sourceBytes * 4) / 3 + 64
      )
        throw Error();
      const bytes = Uint8Array.from(
        atob(uri.slice(uri.indexOf(',') + 1)),
        (c) => c.charCodeAt(0),
      );
      if (!bytes.length || bytes.length > REFERENCE_LIMITS.sourceBytes)
        throw Error();
      onImage(new File([bytes], item.name, { type: 'image/png' }));
      onClose();
    } catch {
      if (active.current)
        setMessage('V3 결과 PNG를 읽을 수 없습니다. 파일과 크기를 확인하세요.');
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={modal}
      className="nai-auth"
      aria-label="V3 자료 가져오기"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>V3 자료 가져오기</h2>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </header>
      <label>
        가져올 V3 세션
        <select
          value={session?.name ?? ''}
          disabled={disabled || busy}
          onChange={async (e) => {
            const name = e.target.value;
            if (!names.includes(name) || !safeName(name)) return;
            setBusy(true);
            setMessage('');
            try {
              const value =
                name === currentSession?.name
                  ? currentSession.toJSON()
                  : JSON.parse(await backend.readFile(`projects/${name}.json`));
              if (!active.current) return;
              if (!value) throw Error();
              const index = readImportIndex(name, value);
              if (name === currentName && name !== savedName) {
                index.maskScenes = [];
                index.scenes = [];
              }
              setSceneKey('');
              setWithPicks(true);
              setSession(index);
              setExcluded([]);
              setSelected('');
              setLibrary('');
            } catch {
              if (active.current) setMessage('세션을 읽을 수 없습니다.');
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          <option value="">세션 선택</option>
          {[...new Set([...names, ...(session ? [session.name] : [])])].map(
            (name) => (
              <option key={name}>{name}</option>
            ),
          )}
        </select>
      </label>
      {session ? (
        <>
          <p>현재 V3 세션 · {session.name}</p>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              try {
                const result = inspectLegacyPresets(session.presetSource);
                if (result.candidates.length) onPresets(result);
                else
                  setMessage(
                    `가져올 프리셋이 없습니다. 형식 오류 ${result.skipped}개`,
                  );
              } catch {
                setMessage(
                  '프리셋의 저장 형식과 라이브러리 한도를 확인하세요.',
                );
              }
            }}
          >
            프리셋을 라이브러리에서 검토
          </button>
          <fieldset disabled={busy || disabled || !session.scenes.length}>
            <legend>저장된 일반 씬</legend>
            <label>
              복사할 씬
              <select
                data-testid="legacy-scene-select"
                value={sceneKey}
                onChange={(e) => setSceneKey(e.target.value)}
              >
                <option value="">씬 선택</option>
                {session.scenes.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {ordinary && (
              <p>
                활성 슬롯 조합 {ordinary.count}개 · 선별 PNG {ordinary.picks}장
              </p>
            )}
            {ordinary &&
              (ordinary.count === 0 ||
                ordinary.count > PROJECT_LIMITS.scenes) && (
                <p>
                  활성 조합이 1~{PROJECT_LIMITS.scenes}개인 씬을 선택하세요.
                </p>
              )}
            <label>
              <input
                type="checkbox"
                data-testid="legacy-with-picks"
                checked={withPicks}
                onChange={(e) => setWithPicks(e.target.checked)}
              />
              선별 PNG 포함
            </label>
            <p>
              활성 조합마다 편집할 씬을 만듭니다. 선별 PNG는 원래 씬 이름으로
              보관합니다. 세션 공통 프리셋은 라이브러리에서 별도로 적용하세요.
            </p>
            <button
              type="button"
              data-testid="legacy-copy-scene"
              disabled={
                !ordinary ||
                ordinary.count < 1 ||
                ordinary.count > PROJECT_LIMITS.scenes ||
                (withPicks && ordinary.picks > PROJECT_LIMITS.results)
              }
              onClick={() => onCopyScene(session.name, sceneKey, withPicks)}
            >
              일반 씬을 새 프로젝트로 복사
            </button>
            {ordinary &&
              withPicks &&
              ordinary.picks > PROJECT_LIMITS.results && (
                <p>
                  프로젝트당 선별 PNG 한도는 {PROJECT_LIMITS.results}장입니다.
                  슬롯만 복사하려면 선별 PNG 포함을 해제하세요.
                </p>
              )}
          </fieldset>
          <fieldset
            disabled={
              busy ||
              disabled ||
              !names.includes(session.name) ||
              !session.maskScenes.length
            }
          >
            <legend>저장된 마스크 씬</legend>
            <p>
              마지막으로 저장한 세션에서
              원본·마스크·프롬프트·시드·스텝·가이던스를 복사합니다. 생성에는 새
              작업실의 강도 1, Karras, 마스크 밖 보존 설정이 적용됩니다.
            </p>
            <details>
              <summary>
                복사할 마스크 씬 선택 ·{' '}
                {session.maskScenes.length - excluded.length}/
                {session.maskScenes.length}
              </summary>
              {session.maskScenes.map(({ key, name }) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!excluded.includes(key)}
                    onChange={(e) =>
                      setExcluded(
                        e.target.checked
                          ? excluded.filter((v) => v !== key)
                          : [...excluded, key],
                      )
                    }
                  />
                  {name}
                </label>
              ))}
              {session.maskScenes.length > PROJECT_LIMITS.scenes && (
                <p>프로젝트당 최대 {PROJECT_LIMITS.scenes}개를 선택하세요.</p>
              )}
            </details>
            <button
              type="button"
              data-testid="legacy-copy-masks"
              disabled={
                excluded.length === session.maskScenes.length ||
                session.maskScenes.length - excluded.length >
                  PROJECT_LIMITS.scenes
              }
              onClick={() =>
                onCopyMasks(
                  session.name,
                  session.maskScenes
                    .filter((s) => !excluded.includes(s.key))
                    .map((s) => s.key),
                )
              }
            >
              마스크 씬을 새 프로젝트로 복사
            </button>
          </fieldset>
          <fieldset
            data-testid="legacy-piece-import"
            disabled={busy || disabled}
          >
            <legend>프롬프트 조각</legend>
            <label>
              조각 모음
              <select
                value={library}
                onChange={(e) => setLibrary(e.target.value)}
              >
                <option value="">선택</option>
                {[...session.library.keys()].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!library}
              onClick={() => {
                try {
                  const incoming = inspectPieceImport(
                    session.library.get(library),
                  ).pieces;
                  const existing = new Set(pieces.map((p) => p.key));
                  const added = incoming.filter((p) => !existing.has(p.key));
                  const merged = [...pieces, ...added];
                  if (!validPieces(merged)) throw Error();
                  if (added.length) onPieces(merged);
                  setMessage(
                    `현재 씬에 ${added.length}개 추가 · 같은 이름 ${incoming.length - added.length}개 유지`,
                  );
                } catch {
                  setMessage('조각의 형식과 개수 한도를 확인하세요.');
                }
              }}
            >
              현재 씬에 조각 추가
            </button>
          </fieldset>
          <fieldset disabled={busy || disabled}>
            <legend>선별·인페인팅 결과</legend>
            <label>
              이미지
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">
                  {images.length
                    ? '이미지 선택'
                    : '세션에 가져올 결과가 없습니다'}
                </option>
                {images.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.scene.type === 'inpaint' ? '인페인팅' : '선별'} ·{' '}
                    {i.scene.name} · {i.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!selected} onClick={importImage}>
              작업실에서 이미지 사용
            </button>
          </fieldset>
        </>
      ) : (
        <p>V3 세션을 선택하면 조각과 결과를 가져올 수 있습니다.</p>
      )}
      <p role="status">{message}</p>
    </dialog>
  );
}

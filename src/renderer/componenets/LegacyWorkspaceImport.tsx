/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../models/types';
import { imageService, sessionService } from '../models';
import { inspectPieceImport, validPieces } from '../../workspacePromptPieces';
import type { PromptPiece } from '../../workspacePromptPieces';
import { REFERENCE_LIMITS } from '../../workspaceReference';

export default function LegacyWorkspaceImport({
  session: currentSession,
  pieces,
  onPieces,
  onImage,
  onClose,
  disabled,
}: {
  session: Session | undefined;
  pieces: PromptPiece[];
  onPieces: (value: PromptPiece[]) => void;
  onImage: (file: File) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [session, setSession] = useState(currentSession);
  const [names, setNames] = useState(() => sessionService.list());
  useEffect(() => {
    const update = () => setNames([...sessionService.list()]);
    sessionService.addEventListener('listupdated', update);
    return () => sessionService.removeEventListener('listupdated', update);
  }, []);
  const modal = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
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
  const images = session
    ? [...session.scenes.values(), ...session.inpaints.values()].flatMap(
        (scene) =>
          (scene.type === 'inpaint' ? scene.imageMap : scene.mains)
            .filter((name) => name.toLowerCase().endsWith('.png'))
            .map((name) => ({
              scene,
              name,
              id: JSON.stringify([scene.type, scene.name, name]),
            })),
      )
    : [];
  const safeName = (name: string) =>
    !!name &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/:*?"<>|]/.test(name) &&
    !/[. ]$/.test(name);
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
      const uri = await imageService.fetchImage(
        `${imageService.getOutputDir(session, item.scene)}/${item.name}`,
      );
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
              const value = await sessionService.get(name);
              if (!active.current) return;
              if (!value) throw Error();
              setSession(value);
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
          <fieldset disabled={busy || disabled}>
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
                    session.library.get(library)?.toJSON(),
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

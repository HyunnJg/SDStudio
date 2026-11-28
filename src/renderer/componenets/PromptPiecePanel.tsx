/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useRef, useState } from 'react';
import {
  PromptPiece,
  inspectPieceImport,
  multiPieceLines,
  validPieces,
} from '../../workspacePromptPieces';

export default function PromptPiecePanel({
  pieces,
  disabled,
  onChange,
  onInsert,
}: {
  pieces: PromptPiece[];
  disabled: boolean;
  onChange: (pieces: PromptPiece[]) => void;
  onInsert: (text: string) => void;
}) {
  const [error, setError] = useState('');
  const request = useRef(0);
  const empty = { key: '', text: '', multi: false };
  const [editor, setEditor] = useState<PromptPiece>(empty);
  const [editing, setEditing] = useState('');
  const lines = editor.multi ? multiPieceLines(editor.text) : undefined;
  const savePiece = () => {
    if (lines && !lines.candidates.length) return;
    const piece = lines
      ? { ...editor, text: lines.candidates.join('\n') }
      : editor;
    const next = editing
      ? pieces.map((p) => (p.key === editing ? piece : p))
      : [...pieces, piece];
    if (
      !validPieces(next) ||
      (editing && !pieces.some((p) => p.key === editing))
    ) {
      setError('모음.조각 형식의 고유한 이름과 조각 크기를 확인하세요.');
      return;
    }
    onChange(next);
    setEditor(piece);
    setEditing(piece.key);
    setError('');
  };
  const [pending, setPending] =
    useState<ReturnType<typeof inspectPieceImport>>();
  return (
    <details className="workspace-pieces">
      <summary>와일드카드·V3 조각 {pieces.length || ''}</summary>
      <p>
        선택지는 {'{맑음|비}'}처럼 입력하세요. 같은 시드는 같은 선택을
        사용합니다.
      </p>
      <label>
        V3 세션·조각 모음 JSON
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            request.current += 1;
            const ticket = request.current;
            setError('');
            setPending(undefined);
            try {
              if (file.size > 2 * 1024 * 1024) throw Error();
              const imported = inspectPieceImport(
                JSON.parse(await file.text()),
              );
              if (request.current === ticket) setPending(imported);
            } catch {
              if (request.current === ticket)
                setError('조각 이름·형식 또는 파일 크기(2 MiB)를 확인하세요.');
            }
          }}
        />
      </label>
      {pending && (
        <button
          data-testid="apply-piece-import"
          disabled={disabled}
          type="button"
          onClick={() => {
            setEditor(empty);
            setEditing('');
            onChange(pending.pieces);
            setPending(undefined);
          }}
        >
          현재 씬의 조각을 {pending.pieces.length}개로 교체
          {pending.ignored > 0 && ` · 빈 줄 ${pending.ignored}개 제외`}
        </button>
      )}
      {pieces.map((p) => (
        <button
          type="button"
          key={p.key}
          disabled={disabled}
          onClick={() => onInsert(`<${p.key}>`)}
        >
          {p.key}
        </button>
      ))}
      <details>
        <summary>조각 편집</summary>
        <fieldset disabled={disabled}>
          <label>
            편집할 조각
            <select
              value={editing}
              onChange={(e) => {
                const piece = pieces.find((p) => p.key === e.target.value);
                setEditing(piece?.key ?? '');
                setEditor(piece ?? empty);
                setError('');
              }}
            >
              <option value="">새 조각</option>
              {pieces.map((p) => (
                <option key={p.key}>{p.key}</option>
              ))}
            </select>
          </label>
          <label>
            모음.조각
            <input
              aria-label="조각 이름"
              maxLength={161}
              readOnly={!!editing}
              value={editor.key}
              onChange={(e) => setEditor({ ...editor, key: e.target.value })}
            />
          </label>
          <label>
            내용
            <textarea
              aria-label="조각 내용"
              rows={3}
              maxLength={65536}
              value={editor.text}
              onChange={(e) => setEditor({ ...editor, text: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={editor.multi}
              onChange={(e) =>
                setEditor({ ...editor, multi: e.target.checked })
              }
            />
            줄마다 후보 한 개
          </label>
          {lines && lines.ignored > 0 && (
            <small>빈 줄 {lines.ignored}개 제외</small>
          )}
          <button
            data-testid="save-scene-piece"
            type="button"
            disabled={!editor.key.trim() || !editor.text.trim()}
            onClick={savePiece}
          >
            씬에 조각 적용
          </button>
        </fieldset>
      </details>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

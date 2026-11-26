/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useRef, useState } from 'react';
import { PromptPiece, importPieces } from '../../workspacePromptPieces';

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
  const request = useRef(0);
  const [pending, setPending] = useState<PromptPiece[]>([]);
  const [error, setError] = useState('');
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
            setPending([]);
            try {
              if (file.size > 2 * 1024 * 1024) throw Error();
              const imported = importPieces(JSON.parse(await file.text()));
              if (request.current === ticket) setPending(imported);
            } catch {
              if (request.current === ticket)
                setError('조각 이름·형식 또는 파일 크기(2 MiB)를 확인하세요.');
            }
          }}
        />
      </label>
      {pending.length > 0 && (
        <button
          disabled={disabled}
          type="button"
          onClick={() => {
            onChange(pending);
            setPending([]);
          }}
        >
          현재 씬의 조각을 {pending.length}개로 교체
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
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

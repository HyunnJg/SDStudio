/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useEffect, useRef, useState } from 'react';
import type { CutSuggestion } from '../../recipeAssistant';
import type { NaiAuthResult, NaiTokenStatus } from '../../naiAuth';
import { authErrorMessage } from '../auth/tokenInput';

export default function RecipeAssistant({
  style,
  characters,
  room,
  onApply,
}: {
  style: string;
  characters: string[];
  room: number;
  onApply: (plan: CutSuggestion) => void;
}) {
  const client = window.electron.recipeAssistant;
  const key = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<NaiTokenStatus>();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState('');
  const [suggestion, setSuggestion] = useState<CutSuggestion>();
  const applyStatus = (result: NaiAuthResult) => {
    if (result.ok) setStatus(result.status);
    else setMessage(authErrorMessage(result.code));
  };
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await client.status();
        if (active) applyStatus(result);
      } catch {
        if (active) setMessage('키 보관 상태를 읽을 수 없습니다.');
      } finally {
        if (active) setBusy(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [client]);

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch {
      setMessage('요청을 처리하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset
      disabled={busy}
      aria-label="Gemini 컷 초안"
      data-testid="recipe-assistant"
    >
      <details open={!status?.configured || undefined}>
        <summary>
          Gemini API 키 {status?.configured ? '설정됨' : '설정'}
        </summary>
        <label>
          Gemini API 키
          <input
            type="password"
            ref={key}
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={remember}
            disabled={!status?.secureStorageAvailable}
            onChange={(e) => setRemember(e.target.checked)}
          />
          이 기기에 암호화해 보관
        </label>
        <button
          type="button"
          onClick={() =>
            act(async () => {
              const result = await client.setKey(
                key.current?.value.trim() ?? '',
                remember,
              );
              if (result.ok && key.current) key.current.value = '';
              applyStatus(result);
            })
          }
        >
          키 보관
        </button>
        {status?.configured && (
          <button
            type="button"
            onClick={() =>
              act(async () => {
                applyStatus(await client.clear());
              })
            }
          >
            보관된 Gemini 키 지우기
          </button>
        )}
      </details>
      <label>
        컷 요청문
        <textarea
          rows={3}
          maxLength={4096}
          value={request}
          placeholder="알현 직전의 긴장, 알현 중의 미소, 끝난 뒤 안도. 마지막만 클로즈업. 각 2장."
          onChange={(e) => {
            setRequest(e.target.value);
            setSuggestion(undefined);
            setMessage('');
          }}
        />
      </label>
      <small>
        Gemini에 요청문과 선택한 프리셋 이름을 보냅니다. Gemini API 이용료가
        발생할 수 있습니다.
      </small>
      <button
        type="button"
        disabled={!status?.configured || !request.trim() || room < 1}
        onClick={() =>
          act(async () => {
            setSuggestion(undefined);
            const result = await client.suggest({
              instruction: request.trim(),
              style,
              characters,
            });
            if (result.ok) setSuggestion(result.suggestion);
            else setMessage(result.message);
          })
        }
      >
        {busy ? '처리 중…' : '컷 초안 받기'}
      </button>
      {suggestion && (
        <>
          <ol>
            {suggestion.cuts.map((cut, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i}>
                <strong>{cut.name}</strong>{' '}
                {[cut.setting, cut.emotion].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ol>
          <p>
            {suggestion.repeats
              ? `조합 전체를 컷당 ${suggestion.repeats}회로 설정`
              : '현재 반복 수 유지'}
          </p>
          {suggestion.cuts.length > room && (
            <p>남은 컷 자리 {room}개를 초과합니다.</p>
          )}
          <button
            type="button"
            disabled={suggestion.cuts.length > room}
            onClick={() => {
              onApply(suggestion);
              setSuggestion(undefined);
              setMessage(`${suggestion.cuts.length}개 컷을 추가했습니다.`);
            }}
          >
            초안을 조합에 추가
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}

/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useEffect, useRef, useState } from 'react';
import type { CutSuggestion } from '../../recipeAssistant';
import { providerLabels, validModelId } from '../../recipeAssistant';
import { ModelFields, useVibeModel } from './VibeProviderSettings';
import './NaiAuthSettings.css';

export default function RecipeAssistant({
  style,
  characters,
  room,
  onApply,
  onClose,
  onSettings,
  disabled,
}: {
  style: string;
  characters: string[];
  room: number;
  onApply: (plan: CutSuggestion) => void;
  onClose: () => void;
  onSettings: () => void;
  disabled: boolean;
}) {
  const choice = useVibeModel();
  const modal = useRef<HTMLDialogElement>(null);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState<CutSuggestion>();
  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  useEffect(() => {
    setPlan(undefined);
    setMessage('');
  }, [choice.provider, choice.model]);
  const reset = () => {
    setPlan(undefined);
    setMessage('');
  };
  const suggest = async () => {
    reset();
    setBusy(true);
    try {
      const result = await window.electron.recipeAssistant.suggest({
        provider: choice.provider,
        model: choice.model,
        instruction: request.trim(),
        style,
        characters,
      });
      if (result.ok) setPlan(result.suggestion);
      setMessage(
        `${providerLabels[choice.provider]} · ${choice.model} · ${result.ok ? `HTTP ${result.httpStatus} 응답 완료 · ${result.responseModel ?? choice.model}` : result.message}`,
      );
    } catch {
      setMessage('응답을 받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      className="nai-auth vibe-editor"
      ref={modal}
      data-testid="recipe-assistant"
      aria-label="바이브 에디터"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>바이브 에디터</h2>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </header>
      <fieldset disabled={busy || disabled}>
        <ModelFields
          choice={{
            ...choice,
            changeProvider: (p) => {
              reset();
              choice.changeProvider(p);
            },
            changeModel: (id) => {
              reset();
              choice.changeModel(id);
            },
          }}
        />
        <button type="button" onClick={onSettings}>
          API 키·연결 설정
        </button>
        <label>
          컷 요청문
          <textarea
            rows={4}
            maxLength={4096}
            value={request}
            placeholder="알현 직전의 긴장, 알현 중의 미소, 끝난 뒤 안도. 마지막만 클로즈업. 각 2장."
            onChange={(e) => {
              reset();
              setRequest(e.target.value);
            }}
          />
        </label>
        <small>
          {providerLabels[choice.provider]}에 요청문과 선택한 프리셋 이름을
          보냅니다. API 이용료가 발생할 수 있습니다.
        </small>
        <button
          type="button"
          data-testid="request-vibe"
          disabled={
            !request.trim() ||
            !room ||
            !validModelId(choice.model, choice.provider)
          }
          onClick={suggest}
        >
          컷 초안 받기
        </button>
      </fieldset>
      <p role="status">{busy ? '응답 대기 중…' : message}</p>
      {plan && (
        <>
          <ol>
            {plan.cuts.map((cut, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={`${i}:${cut.name}`}>
                <strong>{cut.name}</strong>{' '}
                {[cut.setting, cut.emotion].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ol>
          <p>
            {plan.repeats ? `컷마다 ${plan.repeats}회` : '현재 반복 수 유지'}
            {plan.cuts.length > room && ` · 남은 자리 ${room}개 초과`}
          </p>
          <button type="button" onClick={reset}>
            응답 버리기
          </button>
          <button
            data-testid="apply-vibe"
            type="button"
            disabled={disabled || plan.cuts.length > room}
            onClick={() => {
              onApply(plan);
              onClose();
            }}
          >
            초안을 조합에 추가
          </button>
        </>
      )}
    </dialog>
  );
}

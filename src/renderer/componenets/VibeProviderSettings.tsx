/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useEffect, useRef, useState } from 'react';
import {
  defaultModels,
  isProvider,
  PROVIDERS,
  providerLabels,
  validModelId,
} from '../../recipeAssistant';
import type { Provider } from '../../recipeAssistant';
import type { NaiAuthResult, NaiTokenStatus } from '../../naiAuth';
import { authErrorMessage } from '../auth/tokenInput';

export function useVibeModel() {
  const [provider, setProvider] = useState<Provider>(() => {
    const value = localStorage.getItem('vibe.provider');
    return isProvider(value) ? value : 'gemini';
  });
  const readModel = (p: Provider) =>
    localStorage.getItem(`vibe.model.${p}`) ?? defaultModels[p];
  const [model, setModel] = useState(() => readModel(provider));
  useEffect(() => {
    const sync = () => {
      const selected = localStorage.getItem('vibe.provider');
      const source = isProvider(selected) ? selected : 'gemini';
      setProvider(source);
      setModel(readModel(source));
    };
    window.addEventListener('vibe-model-changed', sync);
    return () => window.removeEventListener('vibe-model-changed', sync);
  }, []);
  return {
    provider,
    model,
    changeProvider(p: Provider) {
      localStorage.setItem('vibe.provider', p);
      setProvider(p);
      setModel(readModel(p));
      window.dispatchEvent(new Event('vibe-model-changed'));
    },
    changeModel(id: string) {
      setModel(id);
      if (validModelId(id, provider)) {
        localStorage.setItem(`vibe.model.${provider}`, id);
        window.dispatchEvent(new Event('vibe-model-changed'));
      }
    },
  };
}

export function ModelFields({
  choice,
}: {
  choice: ReturnType<typeof useVibeModel>;
}) {
  const [custom, setCustom] = useState(false);
  const models = [
    defaultModels[choice.provider],
    ...{
      gemini: ['gemini-flash-lite-latest', 'gemini-pro-latest'],
      vertex: ['gemini-2.5-pro', 'gemini-2.5-flash-lite'],
      openai: ['gpt-4.1', 'gpt-4o-mini'],
      anthropic: ['claude-haiku-4-5', 'claude-opus-4-6'],
      openrouter: ['anthropic/claude-sonnet-4.6', 'google/gemini-2.5-flash'],
    }[choice.provider],
  ];
  const manual = custom || !models.includes(choice.model);
  return (
    <div className="vibe-model-fields">
      <label>
        공급자
        <select
          value={choice.provider}
          onChange={(e) => {
            if (isProvider(e.target.value)) {
              setCustom(false);
              choice.changeProvider(e.target.value);
            }
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {providerLabels[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        호출 모델
        <select
          value={manual ? '' : choice.model}
          onChange={(e) => {
            setCustom(!e.target.value);
            if (e.target.value) choice.changeModel(e.target.value);
          }}
        >
          {models.map((id) => (
            <option key={id}>{id}</option>
          ))}
          <option value="">모델 ID 직접 입력</option>
        </select>
      </label>
      {manual && (
        <label>
          모델 ID
          <input
            value={choice.model}
            maxLength={128}
            onChange={(e) => choice.changeModel(e.target.value)}
          />
        </label>
      )}
    </div>
  );
}

export function PaidKeyNotice() {
  return (
    <p id="gemini-billing-notice">
      <strong>
        결제가 활성화된 Google Cloud 프로젝트의 Gemini API 키 사용을 권장합니다.
      </strong>{' '}
      무료 이용 시 요청문과 응답이 Google 서비스 개선에 쓰이고 사람이 검토할 수
      있습니다.
    </p>
  );
}

function KeyControls({
  provider,
  model,
}: {
  provider: Provider;
  model: string;
}) {
  const client = window.electron.providerKeys;
  const key = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<NaiTokenStatus>();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const update = (result: NaiAuthResult) => {
    if (result.ok) setStatus(result.status);
    else setMessage(authErrorMessage(result.code));
  };
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const result = await client.status(provider);
        if (alive) update(result);
      } catch {
        if (alive) setMessage('키 상태를 읽지 못했습니다.');
      } finally {
        if (alive) setBusy(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [client, provider]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch {
      setMessage('요청을 처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset disabled={busy} data-testid="provider-key-settings">
      <legend>{providerLabels[provider]} 연결</legend>
      {provider === 'gemini' && <PaidKeyNotice />}
      {provider === 'vertex' && (
        <small>Vertex AI Express 모드에서 발급한 API 키를 입력하세요.</small>
      )}
      <p>
        {
          {
            none: '등록된 키 없음',
            encrypted: '기기에 암호화해 키 보관 중',
            session: '이번 실행에만 키 보관 중',
          }[status?.storage ?? 'none']
        }
      </p>
      <label>
        API 키
        <input type="password" ref={key} maxLength={4096} autoComplete="off" />
      </label>
      <label className="nai-choice">
        <input
          type="checkbox"
          disabled={!status?.secureStorageAvailable}
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        이 기기에 암호화해 보관
      </label>
      <button
        type="button"
        onClick={() =>
          act(async () => {
            const result = await client.set(
              provider,
              key.current?.value.trim() ?? '',
              remember,
            );
            update(result);
            if (result.ok && key.current) {
              key.current.value = '';
              setMessage('키를 보관했습니다.');
            }
          })
        }
      >
        키 보관
      </button>
      {status?.configured && (
        <>
          <button type="button" onClick={() => setConfirm(!confirm)}>
            {confirm ? '취소' : '키 삭제'}
          </button>
          {confirm && (
            <button
              type="button"
              onClick={() =>
                act(async () => {
                  update(await client.clear(provider));
                  setConfirm(false);
                })
              }
            >
              삭제 확인
            </button>
          )}
          <button
            type="button"
            disabled={!validModelId(model, provider)}
            onClick={() =>
              act(async () => {
                const result = await window.electron.recipeAssistant.suggest({
                  provider,
                  model,
                  style: '',
                  characters: [],
                  instruction: '한 컷. 맑은 하늘.',
                });
                setMessage(
                  result.ok
                    ? `${result.responseModel ?? model} · HTTP ${result.httpStatus} 응답 확인`
                    : `${model} · ${result.message}`,
                );
              })
            }
          >
            모델 응답 확인 (API 1회)
          </button>
        </>
      )}
      <p role="status">{busy ? '처리 중…' : message}</p>
    </fieldset>
  );
}
export default function VibeProviderSettings({
  disabled,
}: {
  disabled: boolean;
}) {
  const choice = useVibeModel();
  return (
    <details className="vibe-api-settings">
      <summary>바이브 에디터 API · 모델</summary>
      <fieldset disabled={disabled}>
        <ModelFields choice={choice} />
        <KeyControls
          key={choice.provider}
          provider={choice.provider}
          model={choice.model}
        />
      </fieldset>
    </details>
  );
}

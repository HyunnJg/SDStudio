/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useCallback, useEffect, useRef, useState } from 'react';
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

import {
  extraFields,
  googleProvider,
  parseExtraBody,
  serviceTiers,
  vibeModels,
} from '../../vibeOptions';
import VertexAccountFields, { readAccountFields } from './VertexAccountFields';

function readOptions(provider: Provider, model: string) {
  const scope = `vibe.options.${provider}.${model}`;
  const tier = localStorage.getItem(`${scope}.tier`) ?? '';
  return {
    scope,
    tier: serviceTiers(provider, model).includes(tier) ? tier : '',
    extraBody: localStorage.getItem(`${scope}.body`) ?? '',
  };
}

export function useVibeModel() {
  const [provider, setProvider] = useState<Provider>(() => {
    const value = localStorage.getItem('vibe.provider');
    return isProvider(value) ? value : 'gemini';
  });
  const readModel = (p: Provider) =>
    localStorage.getItem(`vibe.model.${p}`) ?? defaultModels[p];
  const [model, setModel] = useState(() => readModel(provider));
  const [options, setOptions] = useState(() => readOptions(provider, model));
  let optionError = '';
  try {
    parseExtraBody(provider, options.extraBody);
  } catch (error) {
    optionError = (error as Error).message;
  }
  useEffect(() => {
    const sync = () => {
      const selected = localStorage.getItem('vibe.provider');
      const source = isProvider(selected) ? selected : 'gemini';
      setProvider(source);
      setModel(readModel(source));
      setOptions(readOptions(source, readModel(source)));
    };
    window.addEventListener('vibe-model-changed', sync);
    return () => window.removeEventListener('vibe-model-changed', sync);
  }, []);
  return {
    provider,
    model,
    options,
    optionError,
    changeOptions(tier: string, extraBody: string) {
      setOptions({ ...options, tier, extraBody });
      try {
        parseExtraBody(provider, extraBody);
      } catch {
        return;
      }
      if (!validModelId(model, provider)) return;
      localStorage.setItem(`${options.scope}.tier`, tier);
      localStorage.setItem(`${options.scope}.body`, extraBody);
      window.dispatchEvent(new Event('vibe-model-changed'));
    },
    changeProvider(p: Provider) {
      localStorage.setItem('vibe.provider', p);
      setProvider(p);
      setModel(readModel(p));
      window.dispatchEvent(new Event('vibe-model-changed'));
    },
    changeModel(id: string) {
      setModel(id);
      setOptions(readOptions(provider, id));
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
  const models = vibeModels(choice.provider);
  const tiers = serviceTiers(choice.provider, choice.model);
  const tierLabels: Record<string, string> = {
    flex: 'Flex · 저비용, 대기 가능',
    fast: 'Fast · 빠른 처리, 추가 요금',
    priority: 'Priority · 우선 처리, 추가 요금',
  };
  let example = '{"max_completion_tokens":4096}';
  if (googleProvider(choice.provider))
    example = '{"generationConfig":{"topP":0.9}}';
  if (choice.provider === 'anthropic') example = '{"max_tokens":4096}';
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
      {tiers.length > 0 && (
        <label>
          처리 등급
          <select
            aria-label="처리 등급"
            value={choice.options.tier}
            onChange={(e) =>
              choice.changeOptions(e.target.value, choice.options.extraBody)
            }
          >
            <option value="">공급자 기본값</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {tierLabels[t]}
              </option>
            ))}
          </select>
        </label>
      )}
      <details className="vibe-extra-body">
        <summary>추가 요청값 (JSON)</summary>
        <label>
          요청 본문 옵션
          <textarea
            aria-label="추가 요청값 JSON"
            rows={3}
            maxLength={8192}
            spellCheck={false}
            placeholder={example}
            value={choice.options.extraBody}
            onChange={(e) =>
              choice.changeOptions(choice.options.tier, e.target.value)
            }
          />
        </label>
        <small>
          {googleProvider(choice.provider)
            ? 'generationConfig 안에 입력'
            : '사용할 수 있는 필드'}{' '}
          · {extraFields(choice.provider).join(', ')}
        </small>
        {choice.optionError && <p role="alert">{choice.optionError}</p>}
      </details>
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

function KeyControls({ choice }: { choice: ReturnType<typeof useVibeModel> }) {
  const { provider, model, options, optionError } = choice;
  const account = useRef<HTMLFormElement>(null);
  const client = window.electron.providerKeys;
  const key = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<NaiTokenStatus>();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const update = useCallback(
    (result: NaiAuthResult) => {
      if (result.ok) setStatus(result.status);
      else
        setMessage(
          provider === 'vertexAccount' && result.code === 'INVALID_INPUT'
            ? '서비스 계정의 프로젝트 ID, 이메일, RSA 개인 키를 확인하세요.'
            : authErrorMessage(result.code),
        );
    },
    [provider],
  );
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
  }, [client, provider, update]);
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
      {provider === 'openrouter' && (
        <p>
          프롬프트를 학습에 사용하는 공급자를 제외하려면 OpenRouter 계정의
          Privacy 설정에서 무료 모델과 유료 모델의 학습 허용을 각각 꺼 주세요.
        </p>
      )}
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
      {provider === 'vertexAccount' ? (
        <VertexAccountFields form={account} />
      ) : (
        <label>
          API 키
          <input
            type="password"
            ref={key}
            maxLength={4096}
            autoComplete="off"
          />
        </label>
      )}
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
              account.current
                ? await readAccountFields(account.current)
                : (key.current?.value.trim() ?? ''),
              remember,
            );
            update(result);
            if (result.ok) {
              if (key.current) key.current.value = '';
              account.current?.reset();
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
            disabled={!!optionError || !validModelId(model, provider)}
            onClick={() =>
              act(async () => {
                const result = await window.electron.recipeAssistant.suggest({
                  provider,
                  model,
                  tier: options.tier,
                  extraBody: options.extraBody,
                  style: '',
                  characters: [],
                  instruction: '한 컷. 맑은 하늘.',
                });
                setMessage(
                  result.ok
                    ? `${result.responseModel ?? model} · HTTP ${result.httpStatus} 응답 확인${result.servedTier ? ` · ${result.servedTier}` : ''}`
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
        <KeyControls key={choice.provider} choice={choice} />
      </fieldset>
    </details>
  );
}

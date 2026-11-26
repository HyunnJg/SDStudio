import type { Provider } from './recipeAssistant';
import { defaultModels } from './recipeAssistant';

const google = [
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-4-neon',
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
];
const openai = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'];
const claude = [
  'claude-fable-5-2',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
];
const catalog: Record<Provider, string[]> = {
  gemini: [
    ...google,
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-pro-latest',
  ],
  vertex: [...google, 'gemini-3.5-flash'],
  vertexAccount: [...google, 'gemini-3.5-flash'],
  openai: [...openai, 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
  anthropic: [
    ...claude,
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-opus-4-6',
  ],
  openrouter: [
    ...openai.map((m) => `openai/${m}`),
    ...google.map((m) => `google/${m}`),
    ...claude.map((m) => `anthropic/${m.replace(/(\d)-(\d)$/, '$1.$2')}`),
    'openai/gpt-4.1-mini',
  ],
};
export function vibeModels(provider: Provider) {
  return [...new Set([defaultModels[provider], ...catalog[provider]])];
}

export function serviceTiers(provider: Provider, model: string): string[] {
  if (provider === 'gemini' && google.includes(model))
    return ['flex', 'priority'];
  if (
    provider === 'vertexAccount' &&
    [...google, 'gemini-3.5-flash'].includes(model)
  )
    return model.startsWith('gemini-4-') ? ['priority'] : ['flex', 'priority'];
  if (provider === 'openai' && openai.includes(model))
    return model.startsWith('gpt-6.2-') ? ['fast'] : ['flex', 'fast'];
  if (
    provider === 'anthropic' &&
    ['claude-opus-5-5', 'claude-fable-5-2'].includes(model)
  )
    return ['fast'];
  if (provider === 'openrouter') {
    const [vendor, id] = model.split('/');
    if (vendor === 'openai' && openai.includes(id))
      return id.startsWith('gpt-6.2-') ? ['priority'] : ['flex', 'priority'];
    if (
      vendor === 'anthropic' &&
      ['claude-fable-5.2', 'claude-opus-5.5'].includes(id)
    )
      return ['priority'];
    if (vendor === 'google' && google.includes(id)) return ['flex', 'priority'];
  }
  return [];
}

export function googleProvider(provider: Provider) {
  return (
    provider === 'gemini' ||
    provider === 'vertex' ||
    provider === 'vertexAccount'
  );
}

// User options tune inference. Authentication, messages, schema, tools and delivery belong to the application.
const sampling = ['temperature', 'top_p'];
const googleFields = [
  'temperature',
  'topP',
  'topK',
  'seed',
  'maxOutputTokens',
  'thinkingConfig',
  'stopSequences',
  'frequencyPenalty',
  'presencePenalty',
];
export function extraFields(provider: Provider) {
  if (googleProvider(provider)) return googleFields;
  if (provider === 'anthropic')
    return [
      ...sampling,
      'top_k',
      'max_tokens',
      'thinking',
      'output_config',
      'stop_sequences',
    ];
  if (provider === 'openrouter')
    return [
      ...sampling,
      'top_k',
      'reasoning',
      'seed',
      'max_completion_tokens',
      'frequency_penalty',
      'presence_penalty',
      'stop',
    ];
  return [
    ...sampling,
    'reasoning_effort',
    'verbosity',
    'seed',
    'max_completion_tokens',
    'frequency_penalty',
    'presence_penalty',
    'stop',
  ];
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseExtraBody(provider: Provider, raw: string) {
  if (typeof raw !== 'string' || raw.length > 8192)
    throw Error('추가 요청 JSON은 8192자까지 입력할 수 있습니다.');
  if (!raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error('추가 요청값의 JSON 문법을 확인하세요.');
  }
  if (!object(value)) throw Error('추가 요청값은 JSON 객체로 입력하세요.');
  const isGoogle = googleProvider(provider);
  const fields = isGoogle ? value.generationConfig : value;
  if (isGoogle && Object.keys(value).length === 0) return {};
  if (isGoogle && (Object.keys(value).length !== 1 || !object(fields)))
    throw Error('Google 옵션은 generationConfig 객체 안에 입력하세요.');
  if (
    !object(fields) ||
    Object.keys(fields).some((k) => !extraFields(provider).includes(k))
  )
    throw Error('추가 요청에 사용할 수 없는 필드가 있습니다.');
  const nested: Record<string, string[]> = {
    thinkingConfig: ['thinkingBudget', 'thinkingLevel', 'includeThoughts'],
    thinking: ['type', 'budget_tokens'],
    output_config: ['effort'],
    reasoning: ['effort', 'max_tokens', 'enabled', 'exclude'],
  };
  Object.entries(fields).forEach(([key, arg]) => {
    if (Object.prototype.hasOwnProperty.call(nested, key)) {
      if (
        !object(arg) ||
        Object.entries(arg).some(
          ([k, v]) =>
            !nested[key].includes(k) ||
            !['number', 'string', 'boolean'].includes(typeof v),
        )
      )
        throw Error('추론 옵션의 필드와 값을 확인하세요.');
    } else if (['stop', 'stopSequences', 'stop_sequences'].includes(key)) {
      if (
        !(key === 'stop' && typeof arg === 'string') &&
        !(Array.isArray(arg) && arg.every((s) => typeof s === 'string'))
      )
        throw Error('중지 문자열을 확인하세요.');
    } else if (['reasoning_effort', 'verbosity'].includes(key)) {
      if (typeof arg !== 'string')
        throw Error('추론 옵션을 문자열로 입력하세요.');
    } else if (typeof arg !== 'number' || !Number.isFinite(arg))
      throw Error('샘플링 및 토큰 옵션은 숫자로 입력하세요.');
  });
  return fields;
}

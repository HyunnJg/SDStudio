export const wrongGeminiKeyMessage =
  'NovelAI 토큰 또는 다른 공급자의 키입니다. 선택한 공급자의 API 키를 입력하세요.';

export const isNovelAiToken = (value: unknown) =>
  typeof value === 'string' && /^pst-/i.test(value);

export const PROVIDERS = [
  'gemini',
  'vertex',
  'openai',
  'anthropic',
  'openrouter',
] as const;
export type Provider = (typeof PROVIDERS)[number];
export const providerLabels: Record<Provider, string> = {
  gemini: 'Google Gemini',
  vertex: 'Vertex AI (Express)',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};
export const defaultModels: Record<Provider, string> = {
  gemini: 'gemini-flash-latest',
  vertex: 'gemini-2.5-flash',
  openrouter: 'openai/gpt-4.1-mini',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-6',
};
export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.some((item) => item === value);
}
export function wrongProviderKey(p: Provider, key: unknown) {
  if (typeof key !== 'string') return false;
  if (isNovelAiToken(key)) return true;
  if (key.startsWith('sk-or-')) return p !== 'openrouter';
  if (key.startsWith('sk-ant-')) return p !== 'anthropic';
  if (key.startsWith('sk-')) return p !== 'openai';
  return key.startsWith('AIza') && p !== 'gemini' && p !== 'vertex';
}
export function validModelId(
  value: unknown,
  provider: Provider,
): value is string {
  if (typeof value !== 'string' || value.length > 128) return false;
  if (provider === 'openrouter')
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?(:[a-zA-Z0-9_-]+)?$/.test(
      value,
    );
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}
export interface CutRequest {
  provider?: Provider;
  model?: string;
  instruction: string;
  style: string;
  characters: string[];
}

export interface SuggestedCut {
  name: string;
  setting: string;
  emotion: string;
}

export interface CutSuggestion {
  cuts: SuggestedCut[];
  // Zero means the user did not specify a repeat count.
  repeats: number;
}

export type CutResult =
  | {
      ok: true;
      suggestion: CutSuggestion;
      httpStatus: number;
      responseModel?: string;
    }
  | { ok: false; message: string };

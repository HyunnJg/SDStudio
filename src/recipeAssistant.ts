export const wrongGeminiKeyMessage =
  'NovelAI 토큰을 입력했습니다. Google AI Studio에서 발급한 Gemini API 키를 입력하세요.';

export const isNovelAiToken = (value: unknown) =>
  typeof value === 'string' && /^pst-/i.test(value);

export interface CutRequest {
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
  { ok: true; suggestion: CutSuggestion } | { ok: false; message: string };

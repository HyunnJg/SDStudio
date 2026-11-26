import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type {
  CutRequest,
  CutResult,
  CutSuggestion,
  Provider,
} from '../recipeAssistant';
import {
  defaultModels,
  wrongProviderKey,
  wrongGeminiKeyMessage,
  isProvider,
  validModelId,
  providerLabels,
} from '../recipeAssistant';

const instruction = [
  'Draft editable NovelAI image cuts for the user. Preserve requested order and pairs.',
  'Use Korean cut names. Write concise English image tags for setting (background, composition) and emotion (expression, pose). Either can be empty.',
  'Style and character names are labels only. Their saved prompts will already apply. Do not invent their appearance.',
  'For explicitly random alternatives within a shot use {choice A|choice B} in one row. For coverage of every alternative use separate rows.',
  'Repeats is the uniform number of images per cut explicitly requested, or 0 if unspecified. Do not duplicate rows for repeats.',
].join(' ');
const schema = {
  type: 'OBJECT',
  properties: {
    repeats: { type: 'INTEGER' },
    cuts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          setting: { type: 'STRING' },
          emotion: { type: 'STRING' },
        },
        required: ['name', 'setting', 'emotion'],
      },
    },
  },
  required: ['repeats', 'cuts'],
};

const boundedText = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.length <= max && !s.includes('\0');

function validRequest(r: CutRequest) {
  return (
    r &&
    boundedText(r.instruction, 4096) &&
    r.instruction.trim() &&
    boundedText(r.style, 200) &&
    Array.isArray(r.characters) &&
    r.characters.length <= 60 &&
    r.characters.every((s) => boundedText(s, 200))
  );
}

function parseSuggestion(text: string): CutSuggestion {
  const data = JSON.parse(text);
  if (
    !Number.isInteger(data?.repeats) ||
    data.repeats < 0 ||
    data.repeats > 60 ||
    !Array.isArray(data.cuts) ||
    !data.cuts.length ||
    data.cuts.length > 60
  )
    throw Error();
  const cuts = data.cuts.map((row: Record<string, unknown>) => {
    if (
      !row ||
      !boundedText(row.name, 120) ||
      !row.name.trim() ||
      !boundedText(row.setting, 4096) ||
      !boundedText(row.emotion, 4096) ||
      !(row.setting.trim() || row.emotion.trim())
    )
      throw Error();
    return {
      name: row.name.trim(),
      setting: row.setting.trim(),
      emotion: row.emotion.trim(),
    };
  });
  return { repeats: data.repeats, cuts };
}

function makeCutRequest(
  provider: Provider,
  model: string,
  key: string,
  input: string,
): {
  url: string;
  headers: Record<string, string>;
  body: object;
} {
  const format =
    ' Return only JSON {"cuts":[{"name":"...","setting":"...","emotion":"..."}],"repeats":0}, with no markdown.';
  if (provider === 'openai' || provider === 'openrouter')
    return {
      url:
        provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model,
        ...(provider === 'openai' ? { store: false } : {}),
        max_completion_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: instruction + format },
          { role: 'user', content: input },
        ],
      },
    };
  if (provider === 'anthropic')
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: 8192,
        system: instruction + format,
        messages: [{ role: 'user', content: input }],
      },
    };
  return {
    url:
      provider === 'vertex'
        ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { 'x-goog-api-key': key },
    body: {
      systemInstruction: { parts: [{ text: instruction }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        maxOutputTokens: 8192,
      },
    },
  };
}

function extractCutText(provider: Provider, reply: any) {
  if (provider === 'openai' || provider === 'openrouter') {
    const item = reply?.choices?.[0];
    if (item?.finish_reason === 'length') return { limited: true, text: '' };
    if (item?.finish_reason !== 'stop' || item.message?.refusal) throw Error();
    return { limited: false, text: item.message.content };
  }
  if (provider === 'anthropic') {
    if (reply?.stop_reason === 'max_tokens') return { limited: true, text: '' };
    if (reply?.stop_reason !== 'end_turn') throw Error();
    return {
      limited: false,
      text: reply.content
        .filter((p: { type: string }) => p.type === 'text')
        .map((p: { text: string }) => p.text)
        .join(''),
    };
  }
  const item = reply?.candidates?.[0];
  if (item?.finishReason === 'MAX_TOKENS') return { limited: true, text: '' };
  if (item?.finishReason !== 'STOP') throw Error();
  return {
    limited: false,
    text: item.content.parts
      .filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text: string }) => p.text)
      .join(''),
  };
}

export default function registerGeminiCuts(
  ipc: Pick<IpcMain, 'handle'>,
  readKey: (provider: Provider) => Promise<string>,
  offline: () => boolean,
  trusted: (e: IpcMainInvokeEvent) => boolean,
  send: typeof fetch = (url, options) => fetch(url, options),
) {
  let busy = false;
  ipc.handle(
    'gemini-suggest-cuts',
    async (event, r: CutRequest): Promise<CutResult> => {
      const allowed = () => trusted(event) && !offline();
      if (!allowed())
        return { ok: false, message: '온라인 작업실에서 요청할 수 있습니다.' };
      if (!validRequest(r))
        return {
          ok: false,
          message: '요청문과 선택한 프리셋 이름을 확인하세요.',
        };
      const provider = r.provider === undefined ? 'gemini' : r.provider;
      if (!isProvider(provider))
        return { ok: false, message: '지원하는 공급자를 선택하세요.' };
      const model = r.model === undefined ? defaultModels[provider] : r.model;
      if (!validModelId(model, provider))
        return { ok: false, message: '모델 ID를 확인하세요.' };
      const label = providerLabels[provider];
      if (busy) return { ok: false, message: '이전 컷 요청을 처리 중입니다.' };
      busy = true;
      let message = `${label} API 키를 읽을 수 없습니다. 메뉴의 API 설정을 확인하세요.`;
      try {
        const key = await readKey(provider);
        if (!allowed()) throw Error();
        if (wrongProviderKey(provider, key))
          return { ok: false, message: wrongGeminiKeyMessage };
        message = `${label} 연결에 실패했거나 시간이 초과됐습니다.`;
        const input = JSON.stringify({
          instruction: r.instruction,
          style: r.style,
          characters: r.characters,
        });
        const spec = makeCutRequest(provider, model, key, input);
        const response = await send(spec.url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(60_000),
          headers: { 'Content-Type': 'application/json', ...spec.headers },
          body: JSON.stringify(spec.body),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return {
            ok: false,
            message: `${label} 요청 실패 (HTTP ${response.status}). 키 권한과 사용 한도를 확인하세요.`,
          };
        }
        message = `${label} 응답을 받았으나 컷 형식을 읽지 못했습니다. 요청문을 확인하세요.`;
        const reader = response.body?.getReader();
        if (!reader) throw Error();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 256 * 1024) {
            // eslint-disable-next-line no-await-in-loop
            await reader.cancel();
            throw Error();
          }
          chunks.push(chunk.value);
        }
        const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!allowed()) throw Error();
        const output = extractCutText(provider, reply);
        if (output.limited)
          return {
            ok: false,
            message: `${label} 출력 한도에 도달했습니다. 컷 수를 줄여 나누어 요청하세요.`,
          };
        const reported = reply.modelVersion ?? reply.model;
        return {
          ok: true,
          suggestion: parseSuggestion(output.text),
          httpStatus: response.status,
          ...(validModelId(reported, provider)
            ? { responseModel: reported }
            : {}),
        };
      } catch {
        return { ok: false, message };
      } finally {
        busy = false;
      }
    },
  );
}

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

import { googleProvider, parseExtraBody, serviceTiers } from '../vibeOptions';
import readVibeJSON from './vibeResponse';
import { vertexAuthorization } from './vertexAccount';

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
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i.exec(text.trim());
  const data = JSON.parse(fence ? fence[1] : text);
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
  extra: Record<string, unknown>,
  tier: string,
  project?: string,
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
        ...extra,
        ...(tier ? { service_tier: tier } : {}),
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
        ...extra,
        ...(tier ? { speed: tier } : {}),
        system: instruction + format,
        messages: [{ role: 'user', content: input }],
      },
    };
  let root = 'https://generativelanguage.googleapis.com/v1beta';
  if (provider === 'vertex')
    root = 'https://aiplatform.googleapis.com/v1/publishers/google';
  if (project)
    root = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google`;
  return {
    url: `${root}/models/${model}:generateContent`,
    headers: project
      ? {
          Authorization: `Bearer ${key}`,
          ...(tier
            ? {
                'X-Vertex-AI-LLM-Request-Type': 'shared',
                'X-Vertex-AI-LLM-Shared-Request-Type': tier,
              }
            : {}),
        }
      : { 'x-goog-api-key': key },
    body: {
      ...(provider === 'gemini' && tier ? { serviceTier: tier } : {}),
      systemInstruction: { parts: [{ text: instruction }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        maxOutputTokens: 8192,
        ...extra,
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
  const validId = (id: unknown): id is string =>
    typeof id === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
  let active:
    | {
        id?: string;
        sender: IpcMainInvokeEvent['sender'];
        controller: AbortController;
      }
    | undefined;
  ipc.handle('vibe-cancel-cuts', (event, id: unknown) => {
    if (
      !trusted(event) ||
      !validId(id) ||
      !active ||
      active.id !== id ||
      active.sender !== event.sender
    )
      return false;
    active.controller.abort();
    active = undefined;
    return true;
  });
  ipc.handle(
    'gemini-suggest-cuts',
    async (event, r: CutRequest, id?: string): Promise<CutResult> => {
      const allowed = () => trusted(event) && !offline();
      if (!allowed())
        return { ok: false, message: '온라인 작업실에서 요청할 수 있습니다.' };
      if (!validRequest(r) || (id !== undefined && !validId(id)))
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
      const tier = r.tier === undefined ? '' : r.tier;
      if (tier !== '' && !serviceTiers(provider, model).includes(tier))
        return {
          ok: false,
          message: '선택한 모델이 지원하는 처리 등급을 확인하세요.',
        };
      let extra;
      try {
        extra = parseExtraBody(
          provider,
          r.extraBody === undefined ? '' : r.extraBody,
        );
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
      const label = providerLabels[provider];
      if (active)
        return { ok: false, message: '이전 컷 요청을 처리 중입니다.' };
      const controller = new AbortController();
      active = { id, sender: event.sender, controller };
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(tier === 'flex' ? 600_000 : 60_000),
      ]);
      let message = `${label} API 키를 읽을 수 없습니다. 메뉴의 API 설정을 확인하세요.`;
      try {
        const key = await readKey(provider);
        signal.throwIfAborted();
        if (!allowed()) throw Error();
        if (wrongProviderKey(provider, key))
          return { ok: false, message: wrongGeminiKeyMessage };
        message = `${label} 연결에 실패했거나 시간이 초과됐습니다.`;
        const input = JSON.stringify({
          instruction: r.instruction,
          style: r.style,
          characters: r.characters,
        });
        let account;
        if (provider === 'vertexAccount') {
          message =
            'Vertex 서비스 계정 인증에 실패했습니다. 개인 키와 계정 상태를 확인하세요.';
          account = await vertexAuthorization(key, send, signal);
          signal.throwIfAborted();
          if (!allowed()) throw Error();
          message = 'Vertex 연결에 실패했거나 시간이 초과됐습니다.';
        }
        const spec = makeCutRequest(
          provider,
          model,
          account?.token ?? key,
          input,
          extra,
          tier,
          account?.project,
        );
        const response = await send(spec.url, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'Content-Type': 'application/json', ...spec.headers },
          body: JSON.stringify(spec.body),
        });
        signal.throwIfAborted();
        if (!response.ok) {
          await response.body?.cancel();
          return {
            ok: false,
            message: `${label} 요청 실패 (HTTP ${response.status}). ${response.status === 400 || response.status === 404 ? '모델 ID, 처리 등급과 추가 요청값을 확인하세요.' : '키 권한과 사용 한도를 확인하세요.'}`,
          };
        }
        message = `${label} 응답을 받았으나 컷 형식을 읽지 못했습니다. 요청문을 확인하세요.`;
        const reply = await readVibeJSON(response, 256 * 1024);
        signal.throwIfAborted();
        if (!allowed()) throw Error();
        const output = extractCutText(provider, reply);
        if (output.limited)
          return {
            ok: false,
            message: `${label} 출력 한도에 도달했습니다. 컷 수를 줄여 나누어 요청하세요.`,
          };
        const reported = reply.modelVersion ?? reply.model;
        const serving = googleProvider(provider)
          ? (reply.usageMetadata?.trafficType ??
            response.headers.get('x-gemini-service-tier'))
          : (reply.service_tier ??
            reply.usage?.speed ??
            reply.usage?.service_tier);
        return {
          ok: true,
          ...([
            'standard',
            'standard_only',
            'default',
            'fast',
            'priority',
            'flex',
            'ultrafast',
            'ON_DEMAND',
            'ON_DEMAND_PRIORITY',
            'ON_DEMAND_FLEX',
            'PROVISIONED_THROUGHPUT',
          ].includes(serving)
            ? { servedTier: serving }
            : {}),
          suggestion: parseSuggestion(output.text),
          httpStatus: response.status,
          ...(validModelId(reported, provider)
            ? { responseModel: reported }
            : {}),
        };
      } catch {
        return {
          ok: false,
          message: controller.signal.aborted ? '요청을 취소했습니다.' : message,
        };
      } finally {
        if (active?.controller === controller) active = undefined;
      }
    },
  );
}

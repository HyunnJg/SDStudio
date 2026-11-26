import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { CutRequest, CutResult, CutSuggestion } from '../recipeAssistant';

const endpoint =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
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

export default function registerGeminiCuts(
  ipc: Pick<IpcMain, 'handle'>,
  readKey: () => Promise<string>,
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
      if (busy) return { ok: false, message: '이전 컷 요청을 처리 중입니다.' };
      busy = true;
      let message = 'Gemini API 키를 읽을 수 없습니다. 키 설정을 확인하세요.';
      try {
        const key = await readKey();
        if (!allowed()) throw Error();
        message = 'Gemini에 연결하지 못했거나 시간이 초과됐습니다.';
        const response = await send(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(60_000),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instruction }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: JSON.stringify({
                      instruction: r.instruction,
                      style: r.style,
                      characters: r.characters,
                    }),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              maxOutputTokens: 8192,
            },
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return {
            ok: false,
            message: `Gemini 요청 실패 (HTTP ${response.status}). 키 권한과 사용 한도를 확인하세요.`,
          };
        }
        message =
          '완성된 컷 목록을 받지 못했습니다. 요청을 줄이거나 다시 작성해 주세요.';
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
        const candidate = reply?.candidates?.[0];
        if (candidate?.finishReason !== 'STOP' || !allowed()) throw Error();
        const parts = candidate.content.parts.filter(
          (p: { thought?: boolean }) => !p.thought,
        );
        return {
          ok: true,
          suggestion: parseSuggestion(
            parts.map((p: { text: string }) => p.text).join(''),
          ),
        };
      } catch {
        return { ok: false, message };
      } finally {
        busy = false;
      }
    },
  );
}

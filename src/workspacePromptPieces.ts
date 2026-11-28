/* eslint no-bitwise: off, no-restricted-syntax: off -- Seed mixing uses 32-bit arithmetic; input scans are bounded. */
import type { WorkspaceDraft } from './renderer/preview/workspaceDraft';

export interface PromptPiece {
  key: string;
  text: string;
  multi: boolean;
}
const invalid = (): never => {
  throw Error('UNSUPPORTED_DRAFT');
};
const keyPattern = /^[^<>.|{}\r\n]{1,80}\.[^<>.|{}\r\n]{1,80}$/u;
export function validPieces(value: unknown): value is PromptPiece[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  let total = 0;
  const keys = new Set<string>();
  return value.every((p) => {
    if (
      !p ||
      Object.keys(p).length !== 3 ||
      typeof p.key !== 'string' ||
      !keyPattern.test(p.key) ||
      keys.has(p.key) ||
      typeof p.text !== 'string' ||
      p.text.length > 65536 ||
      /\0/.test(p.key + p.text) ||
      typeof p.multi !== 'boolean'
    )
      return false;
    keys.add(p.key);
    total += p.key.length + p.text.length;
    return total <= 131072;
  });
}

export function multiPieceLines(text: string) {
  const lines = text.split(/\r?\n/);
  const candidates = lines.filter((line) => line.trim().length > 0);
  return { candidates, ignored: lines.length - candidates.length };
}

export function inspectPieceImport(value: unknown) {
  if (!value || typeof value !== 'object') return invalid();
  const data = value as Record<string, any>;
  const libraries = data.pieces
    ? [[data.name ?? data.description, data]]
    : Object.entries(data.library ?? {});
  const out: PromptPiece[] = [];
  for (const [name, lib] of libraries) {
    if (
      !lib ||
      typeof name !== 'string' ||
      !lib.pieces ||
      typeof lib.pieces !== 'object'
    )
      return invalid();
    const pieces = Array.isArray(lib.pieces)
      ? lib.pieces
      : Object.entries(lib.pieces).map(([key, text]) => ({
          name: key,
          prompt: text,
          multi: lib.multi?.[key],
        }));
    for (const piece of pieces) {
      if (!piece || typeof piece.name !== 'string' || out.length >= 256)
        return invalid();
      out.push({
        key: `${name}.${piece.name}`,
        text: piece.prompt,
        multi: piece.multi ?? false,
      });
    }
  }
  if (!out.length || !validPieces(out)) return invalid();
  let ignored = 0;
  const pieces = out.map((p) => {
    if (!p.multi) return p;
    const lines = multiPieceLines(p.text);
    if (!lines.candidates.length) return invalid();
    ignored += lines.ignored;
    return { ...p, text: lines.candidates.join('\n') };
  });
  return { pieces, ignored };
}

export function importPieces(value: unknown): PromptPiece[] {
  return inspectPieceImport(value).pieces;
}

// Use only the approved image seed. Rebinding an interrupted reservation repeats the same choices.
export function expandDraft(
  input: WorkspaceDraft,
  seed: number,
): WorkspaceDraft {
  const dictionary = new Map(input.pieces?.map((p) => [p.key, p]));
  const lineChoices = new Map<string, string[]>();
  let state = seed >>> 0;
  let budget = 524288;
  const pick = (count: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * count);
  };
  const expand = (text: string, path: string[] = [], depth = 0): string => {
    if (!/[<{|]/.test(text)) return text;
    budget -= text.length;
    if (depth > 16 || budget < 0) return invalid();
    let output = '';
    const tokens = /<([^<>\n]{1,161})>|\|\||\{/g;
    let start = 0;
    for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
      output += text.slice(start, match.index);
      if (match[1] !== undefined) {
        const key = match[1];
        if (!key.includes('.')) output += match[0];
        else {
          const piece = dictionary.get(key);
          if (!piece || path.includes(key)) return invalid();
          let chosen = piece.text;
          if (piece.multi) {
            let options = lineChoices.get(key);
            if (!options) {
              options = multiPieceLines(piece.text).candidates;
              if (!options.length) return invalid();
              lineChoices.set(key, options);
            }
            chosen = options[pick(options.length)];
          }
          output += expand(chosen, [...path, key], depth + 1);
        }
      } else if (match[0] === '||') {
        const end = text.indexOf('||', tokens.lastIndex);
        if (end < 0) return invalid();
        const options = text.slice(tokens.lastIndex, end).split('|');
        output += expand(options[pick(options.length)], path, depth + 1);
        tokens.lastIndex = end + 2;
      } else {
        let nesting = 1;
        let i = tokens.lastIndex;
        let mark = i;
        const options: string[] = [];
        while (i < text.length && nesting) {
          budget -= 1;
          if (budget < 0) return invalid();
          if (text[i] === '{') nesting += 1;
          else if (text[i] === '}') nesting -= 1;
          else if (text[i] === '|' && nesting === 1) {
            options.push(text.slice(mark, i));
            mark = i + 1;
          }
          i += 1;
        }
        if (nesting) {
          output += '{';
        } else {
          options.push(text.slice(mark, i - 1));
          output +=
            options.length === 1
              ? `{${expand(options[0], path, depth + 1)}}`
              : expand(options[pick(options.length)], path, depth + 1);
          tokens.lastIndex = i;
        }
      }
      if (output.length > 65536) return invalid();
      start = tokens.lastIndex;
    }
    output += text.slice(start);
    if (output.length > 65536) return invalid();
    return output;
  };
  const draft = {
    ...input,
    prompt: expand(input.prompt),
    negativePrompt: expand(input.negativePrompt),
    characters: input.characters.map((c) =>
      c.enabled &&
      typeof c.prompt === 'string' &&
      c.prompt.trim() &&
      typeof c.negativePrompt === 'string'
        ? {
            ...c,
            prompt: expand(c.prompt),
            negativePrompt: expand(c.negativePrompt),
          }
        : c,
    ),
  };
  delete draft.pieces;
  return draft;
}

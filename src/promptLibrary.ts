import type { WorkspaceDraft } from './renderer/preview/workspaceDraft';
import { V5_QUALITY_TAGS, V5_UC_PRESETS } from './workspaceGenerationSettings';

export type PresetKind = 'main' | 'character';
export type PresetContent = {
  kind: PresetKind;
  name: string;
  prompt: string;
  negativePrompt: string;
  qualityTags?: WorkspaceDraft['qualityTags'];
  ucPreset?: WorkspaceDraft['ucPreset'];
};
export type PromptPreset = PresetContent & { id: string; deleted: boolean };
export interface LibrarySnapshot {
  revision: string;
  entries: PromptPreset[];
}
export type LibraryCode =
  | 'LIBRARY_INPUT'
  | 'LIBRARY_LIMIT'
  | 'LIBRARY_CONFLICT'
  | 'LIBRARY_CORRUPT'
  | 'LIBRARY_VERSION'
  | 'LIBRARY_IO'
  | 'LIBRARY_UNTRUSTED';
export class LibraryError extends Error {
  constructor(readonly code: LibraryCode) {
    super(code);
  }
}
export type LibraryReply =
  { ok: true; value: LibrarySnapshot } | { ok: false; code: LibraryCode };
export interface LibraryClient {
  read: () => Promise<LibraryReply>;
  save: (
    revision: string,
    content: PresetContent,
    id?: string,
  ) => Promise<LibraryReply>;
  setDeleted: (
    revision: string,
    id: string,
    deleted: boolean,
  ) => Promise<LibraryReply>;
  remove: (revision: string, id: string) => Promise<LibraryReply>;
}
export const LIBRARY_LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  entries: 200,
  text: 65536,
});
export function libraryCheck(
  value: unknown,
  code: LibraryCode = 'LIBRARY_INPUT',
): asserts value {
  if (!value) throw new LibraryError(code);
}
export function libraryId(value: unknown): asserts value is string {
  libraryCheck(
    typeof value === 'string' &&
      /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value),
  );
}
export function validatePreset(
  value: unknown,
  stored = false,
): PresetContent | PromptPreset {
  libraryCheck(value && typeof value === 'object' && !Array.isArray(value));
  const p = value as Record<string, unknown>;
  libraryCheck(p.kind === 'main' || p.kind === 'character');
  const keys = [
    'kind',
    'name',
    'prompt',
    'negativePrompt',
    ...(p.kind === 'main' ? ['qualityTags', 'ucPreset'] : []),
    ...(stored ? ['id', 'deleted'] : []),
  ];
  libraryCheck(
    Object.keys(p).length === keys.length &&
      keys.every((key) => Object.hasOwn(p, key)),
  );
  ['name', 'prompt', 'negativePrompt'].forEach((key) =>
    libraryCheck(
      typeof p[key] === 'string' &&
        !(p[key] as string).includes('\0') &&
        (p[key] as string).length <=
          (key === 'name' ? 120 : LIBRARY_LIMITS.text),
    ),
  );
  libraryCheck((p.name as string).trim().length > 0);
  if (p.kind === 'main') {
    libraryCheck(
      typeof p.qualityTags === 'string' &&
        Object.hasOwn(V5_QUALITY_TAGS, p.qualityTags),
    );
    libraryCheck(
      typeof p.ucPreset === 'string' &&
        Object.hasOwn(V5_UC_PRESETS, p.ucPreset),
    );
  }
  if (stored) {
    libraryId(p.id);
    libraryCheck(typeof p.deleted === 'boolean');
  }
  return structuredClone(value) as PresetContent | PromptPreset;
}
export function presetFromDraft(
  draft: WorkspaceDraft,
  kind: PresetKind,
  characterId?: string,
): PresetContent {
  if (kind === 'character') {
    const c = draft.characters.find((v) => v.id === characterId);
    return {
      kind,
      name: '',
      prompt: c?.prompt ?? '',
      negativePrompt: c?.negativePrompt ?? '',
    };
  }
  return {
    kind,
    name: '',
    prompt: draft.prompt,
    negativePrompt: draft.negativePrompt,
    qualityTags: draft.qualityTags ?? 'none',
    ucPreset: draft.ucPreset ?? 'none',
  };
}
export interface PresetApplication {
  mode: 'replace' | 'append';
  prompt: boolean;
  negative: boolean;
  presets: boolean;
  characterId?: string;
}
export function applyPromptPreset(
  draft: WorkspaceDraft,
  preset: PresetContent,
  options: PresetApplication,
  id: () => string = () => crypto.randomUUID(),
): WorkspaceDraft {
  validatePreset(preset);
  libraryCheck(options.mode === 'replace' || options.mode === 'append');
  libraryCheck(
    options.prompt ||
      options.negative ||
      (preset.kind === 'main' && options.presets),
  );
  const next = structuredClone(draft);
  const text = (before: string, after: string) =>
    options.mode === 'replace'
      ? after
      : [before, after].filter((v) => v.length > 0).join('\n');
  if (preset.kind === 'main') {
    if (options.prompt) next.prompt = text(next.prompt, preset.prompt);
    if (options.negative)
      next.negativePrompt = text(next.negativePrompt, preset.negativePrompt);
    if (options.presets) {
      libraryCheck(
        next.family === 'v5' ||
          (preset.qualityTags === 'none' && preset.ucPreset === 'none'),
      );
      if (next.qualityTags !== undefined || preset.qualityTags !== 'none')
        next.qualityTags = preset.qualityTags;
      if (next.ucPreset !== undefined || preset.ucPreset !== 'none')
        next.ucPreset = preset.ucPreset;
    }
  } else {
    let c = next.characters.find((v) => v.id === options.characterId);
    if (options.characterId) libraryCheck(c);
    if (!c) {
      libraryCheck(next.characters.length < 32, 'LIBRARY_LIMIT');
      c = {
        id: id(),
        prompt: '',
        negativePrompt: '',
        enabled: true,
        cell: { row: 2, column: 2 },
      };
      next.characters.push(c);
    }
    if (options.prompt) c.prompt = text(c.prompt, preset.prompt);
    if (options.negative)
      c.negativePrompt = text(c.negativePrompt, preset.negativePrompt);
  }
  return next;
}

// Explicit, local legacy JSON import. Only known text fields are read; no paths or old workflows run.
export function legacyPresetCandidates(value: unknown): PresetContent[] {
  libraryCheck(value && typeof value === 'object' && !Array.isArray(value));
  const root = value as {
    presets?: Record<string, unknown>;
    presetShareds?: Record<string, unknown>;
  };
  libraryCheck(
    root.presets &&
      typeof root.presets === 'object' &&
      !Array.isArray(root.presets),
  );
  const candidates: PresetContent[] = [];
  const { presets } = root;
  ['SDImageGen', 'SDImageGenEasy'].forEach((kind) => {
    const entries = presets[kind];
    if (!Array.isArray(entries)) return;
    libraryCheck(entries.length <= LIBRARY_LIMITS.entries, 'LIBRARY_LIMIT');
    entries.forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return;
      const p = candidate as Record<string, unknown>;
      if (
        ![p.name, p.frontPrompt, p.backPrompt, p.uc].every(
          (v) => typeof v === 'string',
        )
      )
        return;
      const item: PresetContent = {
        kind: 'main',
        name: p.name as string,
        prompt: [p.frontPrompt, p.backPrompt]
          .filter((v) => v !== '')
          .join('\n'),
        negativePrompt: p.uc as string,
        qualityTags: 'none',
        ucPreset: 'none',
      };
      validatePreset(item);
      candidates.push(item);
      libraryCheck(
        candidates.length <= LIBRARY_LIMITS.entries,
        'LIBRARY_LIMIT',
      );
    });
  });
  const shared = root.presetShareds?.SDImageGenEasy;
  if (shared && typeof shared === 'object' && !Array.isArray(shared)) {
    const source = shared as Record<string, unknown>;
    if (
      typeof source.characterPrompt === 'string' &&
      source.characterPrompt.length
    ) {
      const p: PresetContent = {
        kind: 'character',
        name: 'V3 캐릭터 태그',
        prompt: source.characterPrompt,
        negativePrompt: '',
      };
      validatePreset(p);
      candidates.push(p);
    }
    if (
      typeof source.backgroundPrompt === 'string' &&
      typeof source.uc === 'string' &&
      (source.backgroundPrompt.length || source.uc.length)
    ) {
      const p: PresetContent = {
        kind: 'main',
        name: 'V3 배경·공통 부정',
        prompt: source.backgroundPrompt,
        negativePrompt: source.uc,
        qualityTags: 'none',
        ucPreset: 'none',
      };
      validatePreset(p);
      candidates.push(p);
    }
    libraryCheck(candidates.length <= LIBRARY_LIMITS.entries, 'LIBRARY_LIMIT');
  }
  return candidates;
}

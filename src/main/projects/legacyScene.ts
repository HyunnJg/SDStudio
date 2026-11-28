/* eslint no-restricted-syntax: off -- Traverse ordered V3 slots and nested references under project limits. */
import inspectLegacySlots from '../../legacySceneSlots';
import { resolveSize } from '../../workspaceCatalog';
import type { LegacyScenePage } from '../../workspaceProject';
import type { ResolutionKey } from '../../workspaceCatalog';
import { inspectPieceImport, validPieces } from '../../workspacePromptPieces';
import type { PromptPiece } from '../../workspacePromptPieces';
import {
  PROJECT_LIMITS,
  ProjectError,
  projectCheck,
} from '../../workspaceProject';
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';
import { component, record, readLegacySession } from './legacySession';
import type { ReadFile } from './legacySession';

// Follow references in every possible line of a multi-piece, without expanding or choosing a seed.
function referencedPieces(prompt: string, libraries: unknown) {
  const found = new Map<string, PromptPiece>();
  const pending = [prompt];
  while (pending.length) {
    const text = pending.pop()!;
    for (const match of text.matchAll(
      /<([^<>.\n]{1,80})\.([^<>.\n]{1,80})>/g,
    )) {
      const [, group, name] = match;
      const key = `${group}.${name}`;
      if (!found.has(key)) {
        try {
          const all = record(libraries);
          projectCheck(Object.hasOwn(all, group));
          const lib = record(all[group]);
          const candidate = Array.isArray(lib.pieces)
            ? lib.pieces.find((piece) => piece?.name === name)
            : {
                name,
                prompt: record(lib.pieces)[name],
                multi: lib.multi && record(lib.multi)[name],
              };
          const [piece] = inspectPieceImport({
            name: group,
            pieces: [candidate],
          }).pieces;
          found.set(key, piece);
          projectCheck(validPieces([...found.values()]));
          pending.push(piece.text);
        } catch {
          throw new ProjectError('PROJECT_LEGACY_PIECE');
        }
      }
    }
  }
  return [...found.values()];
}

export default function legacyScene(
  root: string,
  sessionName: string,
  key: string,
  withPicks: boolean,
  read: ReadFile,
  page?: LegacyScenePage,
) {
  projectCheck(typeof key === 'string' && typeof withPicks === 'boolean');
  const { session, load } = readLegacySession(root, sessionName, read);
  const rows = record(session.scenes);
  projectCheck(Object.hasOwn(rows, key), 'PROJECT_CONFLICT');
  const row = record(rows[key]);
  const name = row.name ?? key;
  component(name);
  let format = row.resolution;
  if (typeof row.landscape === 'boolean')
    format = row.landscape ? 'landscape' : 'portrait';
  const resolution =
    format === 'custom'
      ? `${row.resolutionWidth}x${row.resolutionHeight}`
      : format;
  projectCheck(typeof resolution === 'string');
  try {
    resolveSize(resolution);
  } catch {
    projectCheck(false);
  }

  const inspected = inspectLegacySlots(row.slots);
  if (!inspected.ok) throw new ProjectError(inspected.error);
  const total = inspected.count;
  const slots = inspected.slots.map((slot) =>
    slot.map((prompt) =>
      prompt
        .replace('\n', ',')
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && t !== '|')
        .join(', '),
    ),
  );
  if (page === undefined)
    projectCheck(total <= PROJECT_LIMITS.scenes, 'PROJECT_LIMIT');
  else {
    projectCheck(page && Number.isSafeInteger(page.number) && page.number >= 1);
    projectCheck(page.total === total, 'PROJECT_CONFLICT');
    projectCheck(page.number <= Math.ceil(total / PROJECT_LIMITS.scenes));
  }
  const start = ((page?.number ?? 1) - 1) * PROJECT_LIMITS.scenes;
  const length = Math.min(PROJECT_LIMITS.scenes, total - start);
  const range =
    total > PROJECT_LIMITS.scenes ? ` · ${start + 1}–${start + length}` : '';
  let textLength = 0;
  const scenes: WorkspaceScene[] = Array.from({ length }, (_, i) => {
    // V3 DFS advances the last slot first. Calculate just this ordinal's choices.
    let ordinal = start + i;
    const parts = new Array<string>(slots.length);
    let promptLength = 0;
    for (let s = slots.length - 1; s >= 0; s -= 1) {
      const slot = slots[s];
      parts[s] = slot[ordinal % slot.length];
      ordinal = Math.floor(ordinal / slot.length);
      if (parts[s]) promptLength += parts[s].length + (promptLength ? 2 : 0);
      projectCheck(promptLength <= 65536, 'PROJECT_LIMIT');
    }
    textLength += promptLength;
    projectCheck(textLength <= PROJECT_LIMITS.jsonBytes, 'PROJECT_LIMIT');
    const prompt = parts.filter(Boolean).join(', ');
    const pieces = referencedPieces(prompt, session.library);
    const suffix = start + i === 0 ? '' : ` · ${start + i + 1}`;
    return {
      id: `scene-${start + i + 1}`,
      name: name.slice(0, 120 - suffix.length) + suffix,
      draft: {
        family: 'v4.5',
        model: 'nai-diffusion-3',
        resolution: resolution as ResolutionKey,
        prompt,
        negativePrompt: '',
        characters: [],
        placement: 'auto',
        steps: '28',
        guidance: '5',
        seedMode: 'random',
        seed: '0',
        ...(pieces.length ? { pieces } : {}),
      },
    };
  });
  const listed = withPicks ? (row.mains ?? (row.main ? [row.main] : [])) : [];
  projectCheck(Array.isArray(listed));
  const files = [...new Set(listed)];
  projectCheck(files.length <= PROJECT_LIMITS.results, 'PROJECT_LIMIT');
  const picks = files.map((filename) => {
    component(filename);
    projectCheck(
      filename.toLowerCase().endsWith('.png'),
      'PROJECT_LEGACY_PICK',
    );
    return {
      filename,
      readPNG: () =>
        load(['outs', sessionName, name, filename], 32 * 1024 * 1024),
    };
  });
  return { name, scenes, picks, range };
}

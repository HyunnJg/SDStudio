/* eslint no-restricted-syntax: off -- Traverse ordered V3 slots and nested references under project limits. */
import { resolveSize } from '../../workspaceCatalog';
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
) {
  projectCheck(typeof key === 'string' && typeof withPicks === 'boolean');
  const { session, load } = readLegacySession(root, sessionName, read);
  const rows = record(session.scenes);
  projectCheck(Object.hasOwn(rows, key), 'PROJECT_CONFLICT');
  const row = record(rows[key]);
  const name = row.name ?? key;
  component(name);
  projectCheck(Array.isArray(row.slots));
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

  let prompts = [''];
  for (const slot of row.slots) {
    projectCheck(Array.isArray(slot));
    const enabled: string[] = [];
    for (const value of slot) {
      const piece = record(value);
      projectCheck(
        piece.enabled === undefined || typeof piece.enabled === 'boolean',
      );
      if (piece.enabled !== false) {
        projectCheck(
          typeof piece.prompt === 'string' && piece.prompt.length <= 65536,
        );
        // V3's standalone insertion marker interleaves slots with a preset front prompt.
        enabled.push(
          piece.prompt
            .replace('\n', ',')
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t && t !== '|')
            .join(', '),
        );
      }
    }
    projectCheck(enabled.length > 0, 'PROJECT_LEGACY_SCENE');
    projectCheck(
      prompts.length * enabled.length <= PROJECT_LIMITS.scenes,
      'PROJECT_LIMIT',
    );
    prompts = prompts.flatMap((prefix) =>
      enabled.map((t) => [prefix, t].filter(Boolean).join(', ')),
    );
    projectCheck(
      prompts.every((p) => p.length <= 65536) &&
        prompts.reduce((n, p) => n + p.length, 0) <= PROJECT_LIMITS.jsonBytes,
      'PROJECT_LIMIT',
    );
  }
  const scenes: WorkspaceScene[] = prompts.map((prompt, i) => {
    const pieces = referencedPieces(prompt, session.library);
    const suffix = i === 0 ? '' : ` · ${i + 1}`;
    return {
      id: `scene-${i + 1}`,
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
  return { name, scenes, picks };
}

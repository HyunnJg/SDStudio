import fs from 'fs';
import path from 'path';
import { allowedSize } from '../../workspaceCatalog';
import {
  PROJECT_LIMITS,
  ProjectError,
  projectCheck,
} from '../../workspaceProject';
import { REFERENCE_LIMITS } from '../../workspaceReference';
import { validatePNGBytes } from '../nai/imageResponse';
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';

type ReadFile = (filename: string, limit: number) => Uint8Array;

function record(value: unknown): Record<string, unknown> {
  projectCheck(
    value && typeof value === 'object' && !Array.isArray(value),
    'PROJECT_LEGACY_MASK',
  );
  return value as Record<string, unknown>;
}

function component(value: unknown): asserts value is string {
  projectCheck(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 180 &&
      !/[\\/:*?"<>|]/.test(value) &&
      Array.from(value).every((c) => c.charCodeAt(0) >= 32) &&
      !/[. ]$/.test(value) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value),
  );
}

export default function legacyMasks(
  root: string,
  sessionName: string,
  read: ReadFile,
) {
  component(sessionName);
  const base = fs.realpathSync(root);
  const load = (parts: string[], limit: number) => {
    parts.forEach(component);
    let folder = base;
    parts.slice(0, -1).forEach((part) => {
      folder = path.join(folder, part);
      const st = fs.lstatSync(folder);
      projectCheck(st.isDirectory() && !st.isSymbolicLink(), 'PROJECT_CORRUPT');
    });
    return read(path.join(folder, parts[parts.length - 1]), limit);
  };
  const bytes = load(['projects', `${sessionName}.json`], 32 * 1024 * 1024);
  const session = record(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  );
  projectCheck(
    session.version === undefined ||
      session.version === 0 ||
      session.version === 1,
    'PROJECT_VERSION',
  );
  const entries = Object.entries(record(session.inpaints)).filter(([, row]) => {
    const { workflowType } = record(row);
    return (
      workflowType === 'SDInpaint' ||
      (workflowType === undefined && !session.version)
    );
  });
  projectCheck(entries.length > 0, 'PROJECT_LEGACY_MASK');
  projectCheck(entries.length <= PROJECT_LIMITS.scenes, 'PROJECT_LIMIT');
  return entries.map(([key, value], index) => {
    const row = record(value);
    const name = row.name ?? key;
    component(name);
    const modern = row.workflowType === 'SDInpaint';
    const preset = modern ? record(row.preset) : row;
    const asset = (kind: 'image' | 'mask') => {
      const field = preset[kind];
      if (modern) {
        component(field);
        projectCheck(field.toLowerCase().endsWith('.png'));
        return load(
          ['vibes', sessionName, field],
          REFERENCE_LIMITS.sourceBytes,
        );
      }
      if (field) {
        projectCheck(
          typeof field === 'string' &&
            field.length <= Math.ceil(REFERENCE_LIMITS.sourceBytes / 3) * 4,
        );
        const decoded = Buffer.from(field, 'base64');
        projectCheck(
          decoded.length <= REFERENCE_LIMITS.sourceBytes &&
            decoded.toString('base64') === field,
        );
        return decoded;
      }
      return load(
        [
          kind === 'image' ? 'inpaint_orgs' : 'inpaint_masks',
          sessionName,
          `${name}.png`,
        ],
        REFERENCE_LIMITS.sourceBytes,
      );
    };
    return () => {
      const image = validatePNGBytes(asset('image'));
      const mask = validatePNGBytes(asset('mask'));
      const dimensions = Buffer.from(
        image.buffer,
        image.byteOffset,
        image.length,
      );
      const width = dimensions.readUInt32BE(16);
      const height = dimensions.readUInt32BE(20);
      projectCheck(allowedSize(width, height));
      const { seed } = preset;
      projectCheck(
        seed == null ||
          (typeof seed === 'number' &&
            Number.isInteger(seed) &&
            seed >= 0 &&
            seed <= 4294967295),
      );
      const prompt = preset.prompt ?? preset.middlePrompt ?? '';
      const negativePrompt = preset.uc ?? '';
      if (typeof prompt !== 'string' || typeof negativePrompt !== 'string')
        throw new ProjectError('PROJECT_LEGACY_MASK');
      const scene: WorkspaceScene = {
        id: `inpaint-${index + 1}`,
        name,
        draft: {
          family: 'v4.5',
          model: 'nai-diffusion-3',
          resolution: `${width}x${height}`,
          characters: [],
          placement: 'auto',
          prompt,
          negativePrompt,
          steps: String(preset.steps ?? 28),
          guidance: String(preset.promptGuidance ?? 5),
          seedMode: seed == null ? 'random' : 'fixed',
          seed: String(seed ?? 0),
        },
      };
      return { scene, image, mask };
    };
  });
}

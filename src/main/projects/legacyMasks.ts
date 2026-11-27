import legacyMaskEntries from '../../legacyMaskEntries';
import { allowedSize } from '../../workspaceCatalog';
import {
  PROJECT_LIMITS,
  ProjectError,
  projectCheck,
} from '../../workspaceProject';
import { REFERENCE_LIMITS } from '../../workspaceReference';
import { validatePNGBytes } from '../nai/imageResponse';
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';

import { component, record, readLegacySession } from './legacySession';
import type { ReadFile } from './legacySession';

export default function legacyMasks(
  root: string,
  sessionName: string,
  read: ReadFile,
  selected?: string[],
) {
  const { session, load } = readLegacySession(root, sessionName, read);
  const entries = legacyMaskEntries(record(session.inpaints), session.version);
  projectCheck(entries.length > 0, 'PROJECT_LEGACY_MASK');
  let included = entries;
  if (selected !== undefined) {
    projectCheck(
      Array.isArray(selected) &&
        selected.length > 0 &&
        selected.length <= PROJECT_LIMITS.scenes,
    );
    const keys = new Set(selected);
    projectCheck(keys.size === selected.length);
    included = entries.filter(({ key }) => keys.has(key));
    projectCheck(included.length === selected.length, 'PROJECT_CONFLICT');
  }
  projectCheck(included.length <= PROJECT_LIMITS.scenes, 'PROJECT_LIMIT');
  return included.map(({ key, value, label: sceneLabel }, index) => {
    const loadScene = () => {
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
          // Non-V5 drafts share this family. The model ID selects V3 Anime.
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
    return { sceneLabel, loadScene };
  });
}

// P0-03 offline projection only. No credentials, transport, model-ID mapping or persistence.
import JSZip from 'jszip';

export type PreviewModelFamily = 'v4.5' | 'v5';

export interface CharacterPromptDraft {
  id: string;
  enabled: boolean;
  prompt: string;
  negativePrompt: string;
  position?: { x: number; y: number };
}

export interface ImageRequestDraft {
  version: 1;
  family: PreviewModelFamily;
  prompt: string;
  negativePrompt: string;
  characters: CharacterPromptDraft[];
  placement: 'auto' | 'manual';
  width: number;
  height: number;
  seed: number;
  steps: number;
  guidance: number;
  cfgRescale: number;
  sampler: string;
  noiseSchedule: string;
}

// These are UI design limits from the official multi-character guide, not API enums.
export const previewCharacterLimits = { 'v4.5': 6, v5: 22 } as const;

function finiteNumber(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Invalid preview ${name}`);
}

function positiveInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid preview ${name}`);
}

export function buildPreviewImageRequest(
  draft: ImageRequestDraft,
  apiModel: string,
) {
  if (
    draft.version !== 1 ||
    !Object.hasOwn(previewCharacterLimits, draft.family)
  )
    throw new Error('Unsupported preview draft version or model family');
  if (!apiModel.trim() || !draft.sampler.trim() || !draft.noiseSchedule.trim())
    throw new Error('Explicit model, sampler and noise schedule are required');
  if (!['auto', 'manual'].includes(draft.placement))
    throw new Error('Invalid preview placement');
  (['width', 'height', 'steps'] as const).forEach((name) =>
    positiveInteger(name, draft[name]),
  );
  // Local draft policy; this does not assert undocumented server parameter limits.
  finiteNumber('seed', draft.seed, 0, 0xffffffff);
  if (!Number.isInteger(draft.seed)) throw new Error('Invalid preview seed');
  finiteNumber('guidance', draft.guidance, 0, Number.MAX_SAFE_INTEGER);
  finiteNumber('cfg rescale', draft.cfgRescale, 0, 1);
  const ids = draft.characters.map((character) => character.id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error('Character IDs must be unique and nonempty');
  const characters = draft.characters.filter((character) => character.enabled);
  if (draft.prompt.includes('|'))
    throw new Error(
      'Inline character syntax is not supported by the preview draft',
    );
  if (characters.length > previewCharacterLimits[draft.family])
    throw new Error('Too many active preview characters');
  const positions = characters.map((character) => {
    if (!character.prompt.trim())
      throw new Error('Active character prompt is empty');
    if (draft.placement === 'auto') return [];
    if (!character.position)
      throw new Error('Manual placement needs each character position');
    const { x, y } = character.position;
    finiteNumber('position x', x, 0, 1);
    finiteNumber('position y', y, 0, 1);
    return [{ x, y }];
  });
  const condition = (negative: boolean) => ({
    caption: {
      base_caption: negative ? draft.negativePrompt : draft.prompt,
      char_captions: characters.map((character, index) => ({
        char_caption: negative ? character.negativePrompt : character.prompt,
        centers: positions[index].map((position) => ({ ...position })),
      })),
    },
    use_coords: draft.placement === 'manual',
    use_order: true,
  });
  return {
    input: draft.prompt,
    model: apiModel,
    parameters: {
      width: draft.width,
      height: draft.height,
      seed: draft.seed,
      steps: draft.steps,
      scale: draft.guidance,
      cfg_rescale: draft.cfgRescale,
      sampler: draft.sampler,
      noise_schedule: draft.noiseSchedule,
      n_samples: 1,
      negative_prompt: draft.negativePrompt,
      v4_prompt: condition(false),
      v4_negative_prompt: condition(true),
    },
  };
}

export async function readPreviewPNGZip(data: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const images = Object.values(zip.files).filter(
    (entry) => !entry.dir && /\.png$/i.test(entry.name),
  );
  // One requested sample: never silently discard an unexpected second image.
  if (images.length !== 1)
    throw new Error('Expected exactly one PNG in the image response');
  const bytes = await images[0].async('uint8array');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value))
    throw new Error('Invalid PNG response signature');
  // Return the original bytes; do not re-encode or strip metadata/alpha channels.
  return bytes;
}

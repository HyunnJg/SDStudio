/* eslint import/prefer-default-export: off */
import { randomInt } from 'crypto';
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';
import type { ProjectImageInput, ImageBinding } from '../../workspaceProject';
import { validateReference } from '../../workspaceProject';
import { referenceDescription } from '../../workspaceReference';
import { hasActiveCharacterPrompt } from '../../workspaceCharacterInput';
import {
  V5_QUALITY_TAGS,
  V5_UC_PRESETS,
  V5_SIZES,
  V5_CHARACTER_LIMIT,
} from '../../workspaceGenerationSettings';

export function bindBasicGeneration(
  scene: WorkspaceScene,
  random = () => randomInt(4294967296),
  referencePNG: Uint8Array | undefined = undefined,
) {
  const d = scene.draft;
  const v5 = d.family === 'v5';
  const reference = d.reference ? validateReference(d.reference) : undefined;
  if (reference && (!v5 || !referencePNG)) throw new Error('UNSUPPORTED_DRAFT');
  const enabledCharacters = d.characters.filter((c) => c.enabled);
  if (
    enabledCharacters.some(
      (c) =>
        typeof c.prompt !== 'string' || typeof c.negativePrompt !== 'string',
    )
  )
    throw new Error('UNSUPPORTED_DRAFT');
  const characters = enabledCharacters.filter(hasActiveCharacterPrompt);
  const inline = (p: string) => p.includes('|') || /<[^>]*\.[^>]*>/.test(p);
  const steps = Number(d.steps);
  const scale = Number(d.guidance);
  if (
    !['v4.5', 'v5'].includes(d.family) ||
    (characters.length > 0 &&
      (!v5 ||
        d.placement !== 'auto' ||
        characters.length > V5_CHARACTER_LIMIT ||
        characters.some(
          (c) =>
            !c.prompt?.trim() ||
            typeof c.negativePrompt !== 'string' ||
            inline(c.prompt) ||
            inline(c.negativePrompt),
        ))) ||
    [d.prompt, d.negativePrompt].some(inline) ||
    (v5
      ? !Object.hasOwn(V5_SIZES, d.resolution) ||
        !/^\d+$/.test(d.steps) ||
        !Number.isInteger(steps) ||
        steps < 1 ||
        steps > 50 ||
        !d.guidance.trim() ||
        !Number.isFinite(scale) ||
        scale <= 0 ||
        scale > 10
      : d.resolution !== 'square' ||
        d.steps !== '28' ||
        d.guidance !== '5' ||
        (d.qualityTags !== undefined && d.qualityTags !== 'none') ||
        (d.ucPreset !== undefined && d.ucPreset !== 'none'))
  )
    throw new Error('UNSUPPORTED_DRAFT');
  if (!d.prompt.trim() && (!v5 || characters.length === 0))
    throw new Error('INVALID_INPUT');
  if (d.seedMode !== 'random' && d.seedMode !== 'fixed')
    throw new Error('INVALID_INPUT');
  if (
    d.seedMode === 'fixed' &&
    (!/^\d+$/.test(d.seed) || Number(d.seed) > 4294967295)
  )
    throw new Error('INVALID_INPUT');
  const seed = d.seedMode === 'fixed' ? Number(d.seed) : random();
  const quality = d.qualityTags ?? 'none';
  const uc = d.ucPreset ?? 'none';
  if (
    !Object.hasOwn(V5_QUALITY_TAGS, quality) ||
    !Object.hasOwn(V5_UC_PRESETS, uc)
  )
    throw new Error('INVALID_INPUT');
  const join = (a: string, b: string) => [a, b].filter(Boolean).join(', ');
  const prompt = v5 ? join(d.prompt, V5_QUALITY_TAGS[quality]) : d.prompt;
  const negative = v5
    ? join(V5_UC_PRESETS[uc], d.negativePrompt)
    : d.negativePrompt;
  const size = v5 ? V5_SIZES[d.resolution] : { width: 512, height: 512 };
  const captions = (negativeCaption: boolean) =>
    characters.map((c) => ({
      char_caption: negativeCaption ? c.negativePrompt : c.prompt,
      // Neutral center; use_coords=false delegates placement to the model.
      centers: [{ x: 0.5, y: 0.5 }],
    }));
  const condition = (text: string) => ({
    caption: { base_caption: text, char_captions: captions(false) },
    use_coords: false,
    use_order: true,
  });
  const request = {
    input: prompt,
    model: v5
      ? ('nai-diffusion-5-full' as const)
      : ('nai-diffusion-4-5-full' as const),
    action: 'generate',
    parameters: {
      params_version: v5 ? 4 : 3,
      ...size,
      steps,
      scale,
      seed,
      n_samples: 1,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      cfg_rescale: 0,
      ...(reference && referencePNG
        ? {
            director_reference_images: [
              Buffer.from(referencePNG).toString('base64'),
            ],
            director_reference_descriptions: [
              {
                caption: {
                  base_caption: referenceDescription(reference),
                  char_captions: [],
                },
                legacy_uc: false,
              },
            ],
            director_reference_information_extracted: [1],
            director_reference_strength_values: [reference.strength],
            director_reference_secondary_strength_values: [0],
          }
        : {}),
      negative_prompt: negative,
      v4_prompt: condition(prompt),
      v4_negative_prompt: v5
        ? {
            caption: { base_caption: negative, char_captions: captions(true) },
            legacy_uc: false,
          }
        : condition(negative),
      ...(v5
        ? {
            image_format: 'png',
            use_coords: false,
            legacy_uc: false,
            legacy: false,
            legacy_v3_extend: false,
            dynamic_thresholding: false,
            skip_cfg_above_sigma: null,
            deliberate_euler_ancestral_bug: false,
            prefer_brownian: true,
            extra_noise_seed: seed - 1,
          }
        : {}),
    },
  };
  const input: ProjectImageInput = {
    sceneId: scene.id,
    model: request.model,
    sampler: request.parameters.sampler,
    noiseSchedule: request.parameters.noise_schedule,
    seed,
    draft: structuredClone(d),
  };
  let bindingId: ImageBinding['id'] = 'nai-v45-basic512-v1';
  if (v5) bindingId = 'nai-v5-full-v1';
  if (v5 && characters.length) bindingId = 'nai-v5-characters-auto-v1';
  if (reference) bindingId = 'nai-v5-reference-v1';
  return { request, input, bindingId, characterCount: characters.length };
}

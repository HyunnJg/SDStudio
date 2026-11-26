import { randomInt } from 'crypto';
import { expandDraft } from '../../workspacePromptPieces';
/* eslint import/prefer-default-export: off */
import {
  MODELS,
  modelId,
  draftSize,
  characterLimit,
} from '../../workspaceCatalog';
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';
import type { ProjectImageInput, ImageBinding } from '../../workspaceProject';
import { validateReference, validateVariation } from '../../workspaceProject';
import { referenceDescription } from '../../workspaceReference';
import { hasActiveCharacterPrompt } from '../../workspaceCharacterInput';
import {
  V5_QUALITY_TAGS,
  V5_UC_PRESETS,
} from '../../workspaceGenerationSettings';

export function bindBasicGeneration(
  scene: WorkspaceScene,
  random = () => randomInt(4294967296),
  images: {
    reference?: Uint8Array;
    img2img?: Uint8Array;
    inpaintSource?: Uint8Array;
    inpaintMask?: Uint8Array;
  } = {},
) {
  if (scene.draft.seedMode !== 'random' && scene.draft.seedMode !== 'fixed')
    throw new Error('INVALID_INPUT');
  if (
    scene.draft.seedMode === 'fixed' &&
    (!/^\d+$/.test(scene.draft.seed) || Number(scene.draft.seed) > 4294967295)
  )
    throw new Error('INVALID_INPUT');
  const seed =
    scene.draft.seedMode === 'fixed' ? Number(scene.draft.seed) : random();
  const medium = scene.draft.model === 'nai-diffusion-5-full-medium';
  if (medium && scene.draft.reference) throw Error('UNSUPPORTED_DRAFT');
  const source = medium
    ? {
        ...scene.draft,
        steps: '14',
        ucPreset: 'heavy' as const,
        negativePrompt: '',
        characters: scene.draft.characters.map((c) => ({
          ...c,
          negativePrompt: '',
        })),
      }
    : scene.draft;
  const d = expandDraft(source, seed);
  const model = modelId(d);
  if (
    !Object.hasOwn(MODELS, model) ||
    model.startsWith('nai-diffusion-5-') !== (d.family === 'v5')
  )
    throw Error('UNSUPPORTED_DRAFT');
  const v3 = model === 'nai-diffusion-3' || model === 'nai-diffusion-furry-3';
  const v5 = d.family === 'v5';
  const reference = d.reference ? validateReference(d.reference) : undefined;
  if (reference && (!v5 || !images.reference))
    throw new Error('UNSUPPORTED_DRAFT');
  const variation = d.img2img ? validateVariation(d.img2img) : undefined;
  if (variation && (!v5 || !images.img2img))
    throw new Error('UNSUPPORTED_DRAFT');
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
      (characterLimit(d) === 0 ||
        d.placement !== 'auto' ||
        characters.length > characterLimit(d) ||
        characters.some(
          (c) =>
            !c.prompt?.trim() ||
            typeof c.negativePrompt !== 'string' ||
            inline(c.prompt) ||
            inline(c.negativePrompt),
        ))) ||
    [d.prompt, d.negativePrompt].some(inline) ||
    (v5 || d.model
      ? !/^\d+$/.test(d.steps) ||
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
  const size = draftSize(d);
  if (
    variation &&
    (variation.width !== size.width || variation.height !== size.height)
  )
    throw new Error('UNSUPPORTED_DRAFT');
  const inpaint = d.inpaintSource;
  if (
    (inpaint || d.inpaintMask) &&
    (model !== 'nai-diffusion-3' ||
      reference ||
      variation ||
      !inpaint ||
      !d.inpaintMask ||
      !images.inpaintSource ||
      !images.inpaintMask ||
      [inpaint, d.inpaintMask].some(
        (asset) => asset.width !== size.width || asset.height !== size.height,
      ))
  )
    throw Error('UNSUPPORTED_DRAFT');
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
  const captionVersion = v5 ? 4 : 3;
  let action = 'generate';
  if (inpaint) action = 'infill';
  else if (variation) action = 'img2img';
  const request = {
    input: prompt,
    model: inpaint ? ('nai-diffusion-3-inpainting' as const) : model,
    action,
    parameters: {
      params_version: v3 ? 1 : captionVersion,
      ...size,
      steps,
      scale,
      seed,
      n_samples: 1,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      cfg_rescale: 0,
      ...(reference && images.reference
        ? {
            director_reference_images: [
              Buffer.from(images.reference).toString('base64'),
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
      ...(variation && images.img2img
        ? {
            image: Buffer.from(images.img2img).toString('base64'),
            strength: variation.strength,
            noise: variation.noise,
          }
        : {}),
      ...(inpaint &&
        images.inpaintSource &&
        images.inpaintMask && {
          image: Buffer.from(images.inpaintSource).toString('base64'),
          mask: Buffer.from(images.inpaintMask).toString('base64'),
          add_original_image: true,
          strength: 1,
          noise: 0,
        }),
      negative_prompt: negative,
      ...(v3
        ? { sm: false, sm_dyn: false, legacy: false }
        : {
            v4_prompt: condition(prompt),
            v4_negative_prompt:
              v5 || d.model
                ? {
                    caption: {
                      base_caption: negative,
                      char_captions: captions(true),
                    },
                    legacy_uc: false,
                  }
                : condition(negative),
          }),
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
            extra_noise_seed: variation ? seed : Math.max(0, seed - 1),
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
  if (d.model || !['portrait', 'landscape', 'square'].includes(d.resolution))
    bindingId = 'nai-catalog-v1';
  if (reference) bindingId = 'nai-v5-reference-v1';
  if (variation)
    bindingId = reference ? 'nai-v5-img2img-reference-v1' : 'nai-v5-img2img-v1';
  if (inpaint) bindingId = 'nai-v3-inpaint-v1';
  return { request, input, bindingId, characterCount: characters.length };
}

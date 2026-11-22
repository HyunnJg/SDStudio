/* eslint import/prefer-default-export: off */
import { randomInt } from 'crypto';
import type { WorkspaceScene } from '../../renderer/preview/workspaceDraft';
import type { ProjectImageInput } from '../../workspaceProject';

// Observed once for the fixed basic request; character/model variations remain unverified.
export function bindBasicGeneration(
  scene: WorkspaceScene,
  random = () => randomInt(4294967296),
) {
  const d = scene.draft;
  if (
    d.family !== 'v4.5' ||
    d.characters.some((c) => c.enabled) ||
    d.resolution !== 'square' ||
    d.steps !== '28' ||
    d.guidance !== '5' ||
    !d.prompt.trim() ||
    [d.prompt, d.negativePrompt].some(
      (p) => p.includes('|') || /<[^>]*\.[^>]*>/.test(p),
    )
  )
    throw new Error('UNSUPPORTED_DRAFT');
  if (
    d.seedMode === 'fixed' &&
    (!/^\d+$/.test(d.seed) || Number(d.seed) > 4294967295)
  )
    throw new Error('INVALID_INPUT');
  const seed = d.seedMode === 'fixed' ? Number(d.seed) : random();
  const condition = (negative: boolean) => ({
    caption: {
      base_caption: negative ? d.negativePrompt : d.prompt,
      char_captions: [],
    },
    use_coords: false,
    use_order: true,
  });
  const request = {
    input: d.prompt,
    model: 'nai-diffusion-4-5-full' as const,
    action: 'generate',
    parameters: {
      params_version: 3,
      width: 512 as const,
      height: 512 as const,
      steps: 28 as const,
      scale: 5 as const,
      seed,
      n_samples: 1,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      cfg_rescale: 0,
      negative_prompt: d.negativePrompt,
      v4_prompt: condition(false),
      v4_negative_prompt: condition(true),
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
  return { request, input };
}

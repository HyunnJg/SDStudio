import { V5_CHARACTER_LIMIT } from './workspaceGenerationSettings';
import type { WorkspaceDraft } from './renderer/preview/workspaceDraft';
import { resolutionMap } from './renderer/backends/imageGen';

export const MODELS = {
  'nai-diffusion-5-full': 'V5 Full',
  'nai-diffusion-5-full-medium': 'V5 Full · Medium',
  'nai-diffusion-5-curated': 'V5 Curated',
  'nai-diffusion-4-5-full': 'V4.5 Full',
  'nai-diffusion-4-5-curated': 'V4.5 Curated',
  'nai-diffusion-4-full': 'V4 Full',
  'nai-diffusion-4-curated-preview': 'V4 Curated Preview',
  'nai-diffusion-3': 'V3 Anime',
  'nai-diffusion-furry-3': 'V3 Furry',
} as const;
export type ModelId = keyof typeof MODELS;
export type ResolutionKey =
  Exclude<keyof typeof resolutionMap, 'custom'> | `${number}x${number}`;
export const modelId = (d: Pick<WorkspaceDraft, 'family' | 'model'>): ModelId =>
  d.model ??
  (d.family === 'v5' ? 'nai-diffusion-5-full' : 'nai-diffusion-4-5-full');
export function allowedSize(width: number, height: number) {
  return (
    [width, height].every(
      (n) => Number.isInteger(n) && n >= 64 && n <= 49152 && n % 64 === 0,
    ) && width * height <= 3145728
  );
}
export function resolveSize(key: string) {
  if (key !== 'custom' && Object.hasOwn(resolutionMap, key))
    return resolutionMap[key as keyof typeof resolutionMap];
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(key);
  if (!match || !allowedSize(Number(match[1]), Number(match[2])))
    throw Error('UNSUPPORTED_DRAFT');
  return { width: Number(match[1]), height: Number(match[2]) };
}
export function draftSize(d: WorkspaceDraft) {
  return d.family === 'v4.5' && !d.model && d.resolution === 'square'
    ? { width: 512, height: 512 }
    : resolveSize(d.resolution);
}

export function characterLimit(d: WorkspaceDraft) {
  if (d.family === 'v5') return V5_CHARACTER_LIMIT;
  return d.model?.startsWith('nai-diffusion-4') ? 6 : 0;
}

// Image bytes live in project assets, never in the draft/IPC plan.
export const REFERENCE_LIMITS = {
  cards: 4,
  sourceBytes: 32 * 1024 * 1024,
  uploadBytes: 5 * 1024 * 1024,
  sourcePixels: 16_000_000,
} as const;
export const GENERATION_BODY_LIMIT = 8 * 1024 * 1024;
export const REFERENCE_ANLAS = 5;

export function imageFormat(
  bytes: Uint8Array,
): 'png' | 'webp' | 'jpeg' | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp';
  return undefined;
}
export type ReferenceRole =
  'character' | 'style' | 'character-style' | 'outfit';
export interface ReferenceAsset {
  id: string;
  sourceHash: string;
  sourceFormat?: 'webp' | 'jpeg';
  sourceBytes: number;
  uploadHash: string;
  uploadBytes: number;
  width: number;
  height: number;
}
export const VARIATION_DEFAULTS = { strength: 0.5, noise: 0 } as const;
export interface WorkspaceVariation extends ReferenceAsset {
  strength: number;
  noise: number;
}
export type ImagePurpose =
  'reference' | 'img2img' | 'inpaintSource' | 'inpaintMask';
export const isInpaintPurpose = (purpose: ImagePurpose) =>
  purpose === 'inpaintSource' || purpose === 'inpaintMask';
export interface WorkspaceReference extends ReferenceAsset {
  role: ReferenceRole;
  strength: number;
  preferSameOutfit: boolean;
}
export interface ReferenceSlots {
  reference?: WorkspaceReference;
  additionalReferences?: WorkspaceReference[];
}

export function sceneReferences(draft: ReferenceSlots): WorkspaceReference[] {
  return draft.reference
    ? [draft.reference, ...(draft.additionalReferences ?? [])]
    : [];
}

export function setSceneReferences(
  draft: ReferenceSlots,
  references: WorkspaceReference[],
) {
  const [first, ...rest] = references;
  if (first) draft.reference = first;
  else delete draft.reference;
  if (rest.length) draft.additionalReferences = rest;
  else delete draft.additionalReferences;
}
export const REFERENCE_ROLES: Record<ReferenceRole, string> = {
  character: '캐릭터',
  style: '화풍',
  'character-style': '캐릭터·화풍',
  outfit: '의상',
};
export function referenceDescription(r: WorkspaceReference): string {
  if (r.role === 'outfit') return 'costume';
  if (r.role === 'style') return 'style';
  if (r.role === 'character-style')
    return r.preferSameOutfit ? 'character&style' : 'character&style_anyoutfit';
  return r.preferSameOutfit ? 'character_mainoutfit' : 'character';
}
// A deliberately small subset of the current V5 ~1MP/64px reference buckets.
export function referenceSize(width: number, height: number) {
  const sizes = [
    [832, 1216],
    [1024, 1024],
    [1216, 832],
  ];
  const target = Math.log(width / height);
  const [w, h] = sizes.reduce((best, current) =>
    Math.abs(Math.log(current[0] / current[1]) - target) <
    Math.abs(Math.log(best[0] / best[1]) - target)
      ? current
      : best,
  );
  return { width: w, height: h };
}
export const REFERENCE_COUNT_NOTICE = `정밀 참조는 씬당 ${REFERENCE_LIMITS.cards}장까지 사용할 수 있습니다. 카드를 교체하거나 해제해 주세요.`;
export const REFERENCE_COST_NOTICE = `참조 이미지는 생성할 때 NovelAI로 전송됩니다. 참조 1장당 생성마다 ${REFERENCE_ANLAS} Anlas가 추가됩니다. 변형 원본은 참조 장수에서 제외합니다. 총 차감액은 생성 설정에 따라 달라질 수 있습니다.`;

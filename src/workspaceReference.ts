// One reference per scene. Image bytes live in project assets, never in the draft/IPC plan.
export const REFERENCE_LIMITS = {
  sourceBytes: 32 * 1024 * 1024,
  uploadBytes: 2 * 1024 * 1024,
  sourcePixels: 16_000_000,
} as const;
export type ReferenceRole =
  'character' | 'style' | 'character-style' | 'outfit';
export interface ReferenceAsset {
  id: string;
  sourceHash: string;
  sourceBytes: number;
  uploadHash: string;
  uploadBytes: number;
  width: number;
  height: number;
}
export interface WorkspaceReference extends ReferenceAsset {
  role: ReferenceRole;
  strength: number;
  preferSameOutfit: boolean;
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
export const REFERENCE_COST_NOTICE =
  '참조 이미지는 생성할 때 NovelAI로 전송됩니다. 공식 안내상 참조 1장당 생성마다 5 Anlas가 추가됩니다. Opus 무료·할당량만 사용한다고 가정하지 마세요. 최종 비용은 NovelAI 웹에서 확인하세요.';

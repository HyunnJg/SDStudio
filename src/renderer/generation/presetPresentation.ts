import type { WorkspaceDraft } from '../preview/workspaceDraft';
import type { PromptPreset, PresetKind } from '../../promptLibrary';

export interface PresetUse {
  name: string;
  kind: PresetKind;
  id?: string;
  characterId?: string;
  mode: 'replace' | 'append';
}
export function presetTextKey(
  draft: WorkspaceDraft,
  characterId?: string,
): string {
  if (characterId) {
    const c = draft.characters.find((item) => item.id === characterId);
    return JSON.stringify([c?.prompt, c?.negativePrompt]);
  }
  return JSON.stringify([
    draft.prompt,
    draft.negativePrompt,
    draft.qualityTags ?? 'none',
    draft.ucPreset ?? 'none',
  ]);
}
export function matchingPreset(
  entries: PromptPreset[],
  draft: WorkspaceDraft,
  characterId?: string,
): PromptPreset | undefined {
  return [...entries].reverse().find((entry) => {
    if (entry.deleted || entry.kind !== (characterId ? 'character' : 'main'))
      return false;
    if (characterId) {
      const c = draft.characters.find((item) => item.id === characterId);
      return (
        !!c &&
        c.prompt === entry.prompt &&
        c.negativePrompt === entry.negativePrompt
      );
    }
    return (
      entry.prompt === draft.prompt &&
      entry.negativePrompt === draft.negativePrompt &&
      entry.qualityTags === (draft.qualityTags ?? 'none') &&
      entry.ucPreset === (draft.ucPreset ?? 'none')
    );
  });
}

/* eslint import/prefer-default-export: off */
import type { WorkspaceCharacter } from './renderer/preview/workspaceDraft';

// Empty enabled cards remain editable drafts, rather than generation conditions.
export function hasActiveCharacterPrompt(
  character: Pick<WorkspaceCharacter, 'enabled' | 'prompt'>,
): boolean {
  return (
    character.enabled &&
    typeof character.prompt === 'string' &&
    character.prompt.trim().length > 0
  );
}

/* eslint import/prefer-default-export: off */
import { createWorkspaceState } from '../preview/workspaceDraft';

export function createConnectedWorkspaceState(family: 'v4.5' | 'v5' = 'v5') {
  const state = createWorkspaceState();
  state.scenes = state.scenes.map((scene) => ({
    ...scene,
    draft: {
      ...scene.draft,
      family,
      characters: [],
      resolution: family === 'v5' ? 'portrait' : 'square',
      steps: family === 'v5' ? '23' : '28',
      guidance: family === 'v5' ? '7' : '5',
      ...(family === 'v5'
        ? { qualityTags: 'standard' as const, ucPreset: 'heavy' as const }
        : {}),
    },
  }));
  state.draft = structuredClone(state.scenes[0].draft);
  state.selectedCharacter = '';
  return state;
}

/* eslint import/prefer-default-export: off */
import { createWorkspaceState } from '../preview/workspaceDraft';

export function createConnectedWorkspaceState() {
  const state = createWorkspaceState();
  state.scenes = state.scenes.map((scene) => ({
    ...scene,
    draft: {
      ...scene.draft,
      characters: [],
      resolution: 'square',
      steps: '28',
      guidance: '5',
    },
  }));
  state.draft = structuredClone(state.scenes[0].draft);
  state.selectedCharacter = '';
  return state;
}

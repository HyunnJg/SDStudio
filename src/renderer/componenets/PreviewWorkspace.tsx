import {
  Dispatch,
  SetStateAction,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { previewCharacterLimits } from '../backends/genVendors/naiPreviewContract';
import {
  WorkspaceState,
  WorkspaceDraft,
  WorkspaceCharacter,
  PreviewRequest,
  PreviewScenario,
  projectWorkspaceDraft,
  randomWorkspaceSeed,
  previewErrorMessage,
} from '../preview/workspaceDraft';
import WorkspacePrompts from './WorkspacePrompts';
import WorkspaceResults from './WorkspaceResults';
import WorkspaceSettings from './WorkspaceSettings';
import WorkspaceScenes from './WorkspaceScenes';
import { WorkspaceQueue } from '../preview/workspaceQueue';
import './PreviewWorkspace.css';

interface Props {
  queue: WorkspaceQueue;
  onResult: (
    image: string,
    request: PreviewRequest,
    sceneName: string,
  ) => number;
  darkMode: boolean;
  onToggleTheme: () => void;
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  legacyName: string;
  legacySceneCount: number;
  onOpenLegacy: () => void;
  onOpenAuth: () => void;
  renderPreview: (
    request: PreviewRequest,
    scenario: PreviewScenario,
  ) => Promise<string>;
}

export default function PreviewWorkspace({
  state,
  setState,
  queue,
  onResult,
  darkMode,
  onToggleTheme,
  legacyName,
  legacySceneCount,
  onOpenLegacy,
  onOpenAuth,
  renderPreview,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{
    sceneId: string;
    character: WorkspaceCharacter;
    index: number;
  } | null>(null);
  const queueState = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const nextCharacter = useRef(3);
  const { draft } = state;
  const character = draft.characters.find(
    (item) => item.id === state.selectedCharacter,
  );
  const active = draft.characters.filter((item) => item.enabled).length;
  const limit = previewCharacterLimits[draft.family];

  const updateDraft = (patch: Partial<WorkspaceDraft>) => {
    setError('');
    setState((previous) => ({
      ...previous,
      draft: { ...previous.draft, ...patch },
    }));
  };
  const updateCharacter = (patch: Partial<WorkspaceCharacter>) => {
    if (!character) return;
    updateDraft({
      characters: draft.characters.map((item) =>
        item.id === character.id ? { ...item, ...patch } : item,
      ),
    });
  };
  const addCharacter = () => {
    // IDs survive view switches and are independent of the visible character order.
    const id = `character-${Date.now()}-${nextCharacter.current}`;
    nextCharacter.current += 1;
    setState((previous) => ({
      ...previous,
      selectedCharacter: id,
      draft: {
        ...previous.draft,
        characters: [
          ...previous.draft.characters,
          {
            id,
            enabled: true,
            prompt: '',
            negativePrompt: '',
            cell: { row: 2, column: 2 },
          },
        ],
      },
    }));
  };
  const removeCharacter = () => {
    if (!character) return;
    setUndo({
      sceneId: state.selectedSceneId,
      character: structuredClone(character),
      index: draft.characters.findIndex((item) => item.id === character.id),
    });
    updateDraft({
      characters: draft.characters.filter((item) => item.id !== character.id),
    });
    setState((previous) => ({
      ...previous,
      selectedCharacter: previous.draft.characters[0]?.id ?? '',
    }));
  };
  const undoCharacter = () => {
    if (
      !undo ||
      undo.sceneId !== state.selectedSceneId ||
      draft.characters.length >= 32
    )
      return;
    const characters = [...draft.characters];
    characters.splice(undo.index, 0, undo.character);
    updateDraft({ characters });
    setState((previous) => ({
      ...previous,
      selectedCharacter: undo.character.id,
    }));
    setUndo(null);
  };
  const generate = async () => {
    setError('');
    try {
      const request = projectWorkspaceDraft(
        draft,
        draft.seedMode === 'random' ? randomWorkspaceSeed() : undefined,
      );
      const sceneName =
        state.scenes.find((item) => item.id === state.selectedSceneId)?.name ??
        '';
      setBusy(true);
      const image = await renderPreview(request, state.scenario);
      onResult(image, request, sceneName);
    } catch (failure) {
      setError(previewErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`preview-workspace ${darkMode ? '' : 'pw-light'}`}
      data-testid="preview-workspace"
    >
      <header className="pw-header">
        <button type="button" data-testid="open-nai-auth" onClick={onOpenAuth}>API 토큰</button>
        <div className="pw-brand">
          <span className="pw-brand-mark" aria-hidden="true">
            S
          </span>
          <strong>SDStudio</strong>
          <span className="pw-brand-sub">작업실</span>
        </div>
        <nav aria-label="작업 화면">
          <span className="pw-current">새 입력 초안</span>
          <button type="button" onClick={onToggleTheme} aria-label="테마 전환">
            {darkMode ? '밝게' : '어둡게'}
          </button>
          <button
            type="button"
            onClick={onOpenLegacy}
            data-testid="open-legacy"
          >
            기존 V3 화면 <span aria-hidden="true">↗</span>
          </button>
        </nav>
        <span className="pw-offline">
          <span aria-hidden="true">●</span> 오프라인 예제
        </span>
      </header>
      <main className="pw-body">
        <WorkspacePrompts
          {...{
            state,
            setState,
            updateDraft,
            updateCharacter,
            addCharacter,
            removeCharacter,
            undoCharacter,
            canUndo:
              !!undo &&
              undo.sceneId === state.selectedSceneId &&
              draft.characters.length < 32,
          }}
        />
        <WorkspaceResults {...{ state, setState }} />
        <WorkspaceSettings
          {...{
            state,
            setState,
            updateDraft,
            legacyName,
            legacySceneCount,
            onOpenLegacy,
          }}
        />
      </main>
      <WorkspaceScenes
        {...{ state, setState, queue, queueState }}
        disabled={
          busy || queueState.active || queueState.running || active > limit
        }
        onSelect={() => {
          setError('');
          setUndo(null);
        }}
        onError={(failure) => setError(previewErrorMessage(failure))}
      />
      <footer className="pw-footer">
        <div className="pw-footer-status" aria-live="polite">
          <span className="pw-status-dot" aria-hidden="true" />
          <div>
            <strong>
              {busy ? '예제를 준비하고 있습니다' : '초안을 자유롭게 편집하세요'}
            </strong>
            <span>실제 생성·저장 없음 · 창을 닫으면 초안이 사라집니다</span>
          </div>
        </div>
        <button
          type="button"
          className="pw-generate"
          data-testid="generate-preview"
          disabled={
            busy || queueState.active || queueState.running || active > limit
          }
          onClick={generate}
        >
          <span aria-hidden="true">✦</span>{' '}
          {busy ? '예제 준비 중' : '예제 만들기'}
        </button>
      </footer>
      {error && (
        <div className="pw-error" role="alert" data-testid="preview-error">
          <strong>예제를 만들지 못했습니다</strong>
          <p>{error}</p>
          <button
            type="button"
            aria-label="오류 닫기"
            onClick={() => setError('')}
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}

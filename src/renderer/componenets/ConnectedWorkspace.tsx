import { flushSync } from 'react-dom';
import {
  useEffect,
  useCallback,
  useState,
  useRef,
  useSyncExternalStore,
  Dispatch,
  SetStateAction,
} from 'react';
import LegacyWorkspaceImport from './LegacyWorkspaceImport';
import type { Session } from '../models/types';
import PromptPiecePanel from './PromptPiecePanel';
import ModelSizeControls from './ModelSizeControls';
import {
  draftSize,
  modelId,
  MODELS,
  characterLimit,
} from '../../workspaceCatalog';
/* eslint no-void: off, jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] -- Promise effects and explicit htmlFor/id controls. */
import {
  DEFAULT_QUEUE_INTERVAL,
  isQueueInterval,
} from '../../workspaceGeneration';
import type {
  GenerationClient,
  GenerationPlan,
  GenerationReply,
  GenerationFailure,
  GeneratedProject,
  GenerationQueuePlan,
  GenerationQueueState,
  GenerationQueueStatus,
} from '../../workspaceGeneration';
import {
  PROJECT_LIMITS,
  ProjectError,
  isProjectCapacityCode,
} from '../../workspaceProject';
import type {
  ProjectCapacityCode,
  ResultTrashReport,
  ProjectClient,
} from '../../workspaceProject';
import {
  ProjectController,
  projectErrorMessage,
} from '../projects/projectController';
import type { WorkspaceState, WorkspaceDraft } from '../preview/workspaceDraft';
import { selectWorkspaceScene } from '../preview/workspaceDraft';
import { runtimeOptions } from '../runtime';
import WorkspaceProjectControls from './WorkspaceProjectControls';
import SceneRecipePanel from './SceneRecipePanel';
import ConnectedQueueControls from './ConnectedQueueControls';
import ConnectedCharacters from './ConnectedCharacters';
import ConnectedImageHistory from './ConnectedImageHistory';
import PNGMetadataImport from './PNGMetadataImport';
import PromptLibrary from './PromptLibrary';
import WorkspaceMaskEditor from './WorkspaceMaskEditor';
import type { MaskImages } from './WorkspaceMaskEditor';
import WorkspaceImageChoice from './WorkspaceImageChoice';
import WorkspaceResultTrash from './WorkspaceResultTrash';
import {
  matchingPreset,
  presetTextKey,
} from '../generation/presetPresentation';
import type { PresetUse } from '../generation/presetPresentation';
import needsSingleUsageConfirmation from '../generation/workspaceUx';
import ConnectedReference from './ConnectedReference';
import {
  REFERENCE_LIMITS,
  REFERENCE_ROLES,
  REFERENCE_COST_NOTICE,
  VARIATION_DEFAULTS,
  isInpaintPurpose,
} from '../../workspaceReference';
import type { ImagePurpose } from '../../workspaceReference';
import { hasActiveCharacterPrompt } from '../../workspaceCharacterInput';

import type {
  PresetKind,
  LegacyPresetImport,
  PromptPreset,
  LibrarySnapshot,
} from '../../promptLibrary';
import {
  generationMessage,
  availableQueueSceneIds,
  queueOutcome,
  ANLAS_STEP_WARNING,
  requiresAnlasWarning,
} from '../generation/generationPresentation';
import './PreviewWorkspace.css';
import './ConnectedWorkspace.css';

function unwrap<T>(reply: GenerationReply<T>): T {
  if (!reply.ok) throw reply;
  return reply.value;
}
interface Props {
  legacySession: Session | undefined;
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  project: ProjectController;
  projectLocked: boolean;
  darkMode: boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenAuth: () => void;
  onOpenLegacy: (tool: 'session' | 'inpaint' | 'pieces') => void;
  onToggleTheme: () => void;
}
// One reference only: include reference count in the acknowledgement key before supporting multiple references.
// User acknowledgement lasts for this renderer session; it is not a server price guarantee.
let referenceCostAcknowledged = false;

export default function ConnectedWorkspace({
  legacySession,
  state,
  setState,
  project,
  projectLocked,
  darkMode,
  onBusyChange,
  onOpenAuth,
  onOpenLegacy,
  onToggleTheme,
}: Props) {
  const client: GenerationClient = window.electron.generation;
  const { projects }: { projects: ProjectClient } = window.electron;
  const view = useSyncExternalStore(project.subscribe, project.getSnapshot);
  const operation = useRef(false);
  const generationEpoch = useRef(0);
  const [phase, setPhase] = useState('');
  const [singlePlan, setSinglePlan] = useState<GenerationPlan>();
  const singleConfirmation = useRef<HTMLElement>(null);
  const [queuePlan, setQueuePlan] = useState<GenerationQueuePlan>();
  const [queue, setQueue] = useState<GenerationQueueState>();
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [repeats, setRepeats] = useState('2');
  const [intervalText, setIntervalText] = useState(() => {
    const saved = localStorage.getItem('workspace.queueIntervalSeconds');
    return saved?.trim() && isQueueInterval(Number(saved))
      ? saved
      : String(DEFAULT_QUEUE_INTERVAL);
  });
  const intervalValid =
    intervalText.trim() !== '' && isQueueInterval(Number(intervalText));
  const availableSceneIds = availableQueueSceneIds(sceneIds, state.scenes);
  const sceneNames = useRef<{ id: string; name: string }[]>([]);
  sceneNames.current = [
    ...state.scenes,
    ...(queue?.items.map((item) => ({
      id: item.sceneId,
      name: item.sceneName,
    })) ?? []),
  ];
  const revisionRef = useRef(view.revision);
  revisionRef.current = view.revision;
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [storageStopped, setStorageStopped] = useState(false);
  const [active, setActive] = useState(false);
  const [feedback, setMessage] = useState<
    | string
    | { code: ProjectCapacityCode; projectId: string; inputEpoch: number }
  >('');
  const capacity =
    typeof feedback === 'object' &&
    feedback.projectId === view.id &&
    feedback.inputEpoch === view.inputEpoch
      ? feedback
      : undefined;
  const textFeedback = typeof feedback === 'string' ? feedback : '';
  const message = capacity ? projectErrorMessage(capacity.code) : textFeedback;
  const showGenerationFailure = (error: unknown) => {
    const failure = error as Partial<GenerationFailure>;
    const { id, inputEpoch } = project.getSnapshot();
    if (
      id &&
      isProjectCapacityCode(failure?.code) &&
      !failure.mayHaveReachedServer &&
      !failure.pendingResult
    )
      setMessage({ code: failure.code, projectId: id, inputEpoch });
    else setMessage(generationMessage(error, sceneNames.current));
  };
  const images = view.imageRecords;
  const [trashReport, setTrashReport] = useState<ResultTrashReport>();
  const [resultTrashOpen, setResultTrashOpen] = useState(false);
  const [lastTrashedImage, setLastTrashedImage] = useState<{
    projectId: string;
    imageId: string;
  }>();
  const [selected, setSelected] = useState('');
  const [imageURL, setImageURL] = useState('');
  const [importFile, setImportFile] = useState<File>();
  const [metadataUndo, setMetadataUndo] = useState<{
    before: WorkspaceDraft;
    after: WorkspaceDraft;
    characterId?: string;
    sceneId: string;
    epoch: number;
  }>();
  const canUndoMetadata =
    metadataUndo &&
    metadataUndo.after === state.draft &&
    metadataUndo.sceneId === state.selectedSceneId &&
    metadataUndo.epoch === view.inputEpoch;
  useEffect(() => {
    if (metadataUndo && !canUndoMetadata) setMetadataUndo(undefined);
  }, [metadataUndo, canUndoMetadata]);
  const [referencePreview, setReferencePreview] = useState<{
    hash: string;
    bytes: Uint8Array;
  }>();
  const liveScene = useRef(state.selectedSceneId);
  liveScene.current = state.selectedSceneId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [libraryRequest, setLibraryRequest] = useState<{
    legacy?: LegacyPresetImport;
    kind: PresetKind;
    characterId?: string;
    initialId?: string;
  }>();
  const [maskImages, setMaskImages] = useState<MaskImages>();
  const [imageChoice, setImageChoice] = useState<File>();
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetUndo, setPresetUndo] = useState<{
    scene: string;
    epoch: number;
    before: WorkspaceDraft;
    after: string;
    name: string;
  }>();
  const [uses, setUses] = useState<
    (PresetUse & {
      sceneId: string;
      projectId?: string;
      fingerprint: string;
      inputEpoch: number;
    })[]
  >([]);
  const presetScope = useRef({ id: view.id, inputEpoch: view.inputEpoch });
  useEffect(() => {
    const previous = presetScope.current;
    presetScope.current = { id: view.id, inputEpoch: view.inputEpoch };
    if (previous.inputEpoch !== view.inputEpoch) setUses([]);
    else if (!previous.id && view.id)
      setUses((items) =>
        items.map((item) =>
          item.projectId === undefined ? { ...item, projectId: view.id } : item,
        ),
      );
  }, [view.id, view.inputEpoch]);
  const acceptLibrary = useCallback(
    (snapshot: LibrarySnapshot) => setPresets(snapshot.entries),
    [],
  );
  useEffect(() => {
    let alive = true;
    window.electron.promptLibrary
      .read()
      .then((reply) => {
        if (alive && reply.ok) setPresets(reply.value.entries);
        return undefined;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [libraryBlocking, setLibraryBlocking] = useState(false);
  const [characterEpoch, setCharacterEpoch] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setMaskImages(undefined);
    setImportFile(undefined);
    setResultTrashOpen(false);
    setImageChoice(undefined);
    setLibraryRequest(undefined);
  }, [view.id, state.selectedSceneId, state.draft.family]);
  const [promptTab, setPromptTab] = useState<'prompt' | 'negative'>('prompt');
  const [vibeOpen, setVibeOpen] = useState(false);
  const [legacyImport, setLegacyImport] = useState(false);
  const [removeId, setRemoveId] = useState('');
  useEffect(() => {
    setVibeOpen(false);
    setLegacyImport(false);
    setRemoveId('');
  }, [state.selectedSceneId, view.inputEpoch]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'input' | 'result'>('input');
  const queueConfirmation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (queuePlan) {
      setMobilePane('result');
      setSidebarOpen(false);
      queueConfirmation.current?.scrollIntoView({ block: 'nearest' });
      queueConfirmation.current?.focus();
    }
  }, [queuePlan, mobilePane]);
  useEffect(() => {
    if (singlePlan || pending) {
      setMobilePane('result');
      setSidebarOpen(false);
    }
  }, [singlePlan, pending]);
  const busy = !!phase || pending || active;
  const locked = busy || projectLocked;
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => busyCallback.current(false), []);
  const characterOverflow =
    characterLimit(state.draft) > 0 &&
    state.draft.characters.filter(hasActiveCharacterPrompt).length >
      characterLimit(state.draft);
  useEffect(() => {
    if (singlePlan) {
      singleConfirmation.current?.scrollIntoView({ block: 'nearest' });
      singleConfirmation.current?.focus();
    }
  }, [singlePlan, mobilePane]);
  useEffect(() => {
    setSceneIds([]);
  }, [view.id]);
  useEffect(() => {
    setSceneIds((previous) => availableQueueSceneIds(previous, state.scenes));
  }, [state.scenes]);
  useEffect(() => setDiscardConfirmed(false), [pending]);
  useEffect(() => {
    onBusyChange(busy || libraryBlocking);
  }, [busy, libraryBlocking, onBusyChange]);
  useEffect(() => {
    let alive = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const epoch = generationEpoch.current;
      try {
        const status = unwrap(await client.status());
        const knownRevision = revisionRef.current;
        const queued = unwrap(await client.queueStatus(knownRevision));
        if (alive && epoch === generationEpoch.current) {
          setQueue(queued.queue);
          const current = project.getSnapshot();
          if (
            queued.latest &&
            current.id === queued.latest.snapshot.project.id &&
            current.revision === knownRevision
          ) {
            project.acceptGenerated(queued.latest.snapshot);
            setSelected(queued.latest.imageId);
          }
        }
        if (alive && epoch === generationEpoch.current) {
          setPending(status.pending || queueOutcome(queued.queue).pending);
          setActive(status.active || !!queued.queue?.running);
        }
      } catch {
        if (alive && epoch === generationEpoch.current)
          setMessage(
            '생성 상태를 확인하지 못했습니다. 요청을 다시 보내지 말고 앱 상태를 확인하세요.',
          );
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, project]);
  useEffect(() => {
    setSelected((previous) =>
      images.some((image) => image.id === previous)
        ? previous
        : (images.at(-1)?.id ?? ''),
    );
  }, [images]);
  useEffect(() => {
    let alive = true;
    let url = '';
    setImageURL('');
    if (view.id && selected)
      void client
        .image(view.id, selected)
        .then((reply) => {
          if (!alive) return undefined;
          const bytes = unwrap(reply);
          url = URL.createObjectURL(
            new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
          );
          setImageURL(url);
          return undefined;
        })
        .catch((error) => {
          if (alive) setMessage(generationMessage(error, sceneNames.current));
        });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, view.id, selected]);
  const patch = (value: Partial<WorkspaceDraft>) => {
    setSinglePlan(undefined);
    setQueuePlan(undefined);
    setState((previous) => {
      const draft = { ...previous.draft, ...value };
      if (!draft.model) delete draft.model;
      return { ...previous, draft };
    });
  };
  const setSceneImage = <K extends ImagePurpose>(
    purpose: K,
    image?: WorkspaceDraft[K],
  ) => {
    setSinglePlan(undefined);
    setQueuePlan(undefined);
    setState((previous) => {
      const draft = { ...previous.draft };
      if (purpose === 'inpaintSource') delete draft.inpaintMask;
      if (image) draft[purpose] = image;
      else delete draft[purpose];
      return { ...previous, draft };
    });
  };
  const attachImage = async (
    source: File | { projectId: string; imageId: string },
    purpose: ImagePurpose,
  ) => {
    if (operation.current || locked) return false;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('reference');
    setMessage('');
    setSinglePlan(undefined);
    setQueuePlan(undefined);
    const sceneId = state.selectedSceneId;
    try {
      if (
        (isInpaintPurpose(purpose)
          ? state.draft.model !== 'nai-diffusion-3'
          : state.draft.family !== 'v5') ||
        (purpose === 'reference' &&
          state.draft.model === 'nai-diffusion-5-full-medium') ||
        (source instanceof File &&
          (source.size > REFERENCE_LIMITS.sourceBytes || source.size === 0))
      )
        throw new ProjectError('PROJECT_INPUT');
      if (!(await project.save())) return false;
      const saved = project.getSnapshot();
      let bytes: Uint8Array;
      if (source instanceof File)
        bytes = new Uint8Array(await source.arrayBuffer());
      else {
        if (source.projectId !== saved.id) return false;
        bytes = unwrap(await client.image(source.projectId, source.imageId));
      }
      if (
        !mounted.current ||
        liveScene.current !== sceneId ||
        project.getSnapshot().id !== saved.id
      )
        return false;
      const imported = unwrap(
        await client.importReference(
          saved.id!,
          saved.revision!,
          bytes,
          purpose,
        ),
      );
      if (
        !mounted.current ||
        liveScene.current !== sceneId ||
        project.getSnapshot().id !== saved.id
      )
        return false;
      setReferencePreview({
        hash: imported.asset.uploadHash,
        bytes: imported.preview,
      });
      if (purpose === 'inpaintSource') {
        setSceneImage(purpose, imported.asset);
        setMaskImages({
          source: new Blob([new Uint8Array(imported.preview)], {
            type: 'image/png',
          }),
          width: imported.asset.width,
          height: imported.asset.height,
        });
      } else if (purpose === 'inpaintMask')
        setSceneImage(purpose, imported.asset);
      else if (purpose === 'img2img')
        setSceneImage(purpose, {
          ...imported.asset,
          strength:
            state.draft.img2img?.strength ?? VARIATION_DEFAULTS.strength,
          noise: state.draft.img2img?.noise ?? VARIATION_DEFAULTS.noise,
        });
      else
        setSceneImage(purpose, {
          ...imported.asset,
          role: state.draft.reference?.role ?? 'character',
          strength: state.draft.reference?.strength ?? 1,
          preferSameOutfit: state.draft.reference?.preferSameOutfit ?? false,
        });
      setMessage('');
      return true;
    } catch (error) {
      if (mounted.current)
        setMessage(generationMessage(error, sceneNames.current));
      return false;
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      if (mounted.current) setPhase('');
    }
  };
  const editMask = async () => {
    if (locked || operation.current || !state.draft.inpaintSource) return;
    operation.current = true;
    setPhase('image');
    const scene = state.selectedSceneId;
    try {
      if (!(await project.save())) return;
      const id = project.getSnapshot().id!;
      const read = async (purpose: ImagePurpose) =>
        new Blob(
          [
            new Uint8Array(
              unwrap(await client.referenceImage(id, scene, purpose)),
            ),
          ],
          { type: 'image/png' },
        );
      const [source, mask] = await Promise.all([
        read('inpaintSource'),
        state.draft.inpaintMask && read('inpaintMask'),
      ]);
      if (
        mounted.current &&
        id === project.getSnapshot().id &&
        scene === liveScene.current
      )
        setMaskImages({
          source,
          mask,
          width: state.draft.inpaintSource.width,
          height: state.draft.inpaintSource.height,
        });
    } catch (error) {
      if (mounted.current)
        setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      if (mounted.current) setPhase('');
    }
  };
  const accept = (value: GeneratedProject, asNewProject = false) => {
    project.acceptGenerated(value.snapshot, asNewProject);
    setSelected(value.imageId);
    setMobilePane('result');
    setPending(false);
    setMessage('완료');
  };
  const prepare = async () => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setMessage('');
    setSinglePlan(undefined);
    setPhase('save');
    try {
      if (!(await project.save())) return;
      const saved = project.getSnapshot();
      const prepared = unwrap(
        await client.prepare(saved.id!, saved.revision!, state.selectedSceneId),
      );
      if (needsSingleUsageConfirmation(prepared, referenceCostAcknowledged)) {
        setSinglePlan(prepared);
        setPhase('single-confirm');
        return;
      }
      setPhase('run');
      accept(unwrap(await client.run(prepared.ticket, true)));
    } catch (error) {
      showGenerationFailure(error);
      setPending(!!(error as GenerationFailure).pendingResult);
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase((previous) => (previous === 'single-confirm' ? previous : ''));
    }
  };
  const confirmHighSteps = async () => {
    if (operation.current || !singlePlan) return;
    const { ticket } = singlePlan;
    operation.current = true;
    generationEpoch.current += 1;
    setSinglePlan(undefined);
    setMessage('');
    setPhase('run');
    if (singlePlan.reference) referenceCostAcknowledged = true;
    try {
      accept(unwrap(await client.run(ticket, true)));
    } catch (error) {
      showGenerationFailure(error);
      setPending(!!(error as GenerationFailure).pendingResult);
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const retryResult = async (asNewProject = false) => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('run');
    setMessage('');
    try {
      accept(unwrap(await client.retrySave(asNewProject)), asNewProject);
    } catch (error) {
      setStorageStopped(
        (error as GenerationFailure).projectCode === 'PROJECT_SERVICE_STOPPED',
      );
      showGenerationFailure(error);
      setPending(!!(error as GenerationFailure).pendingResult);
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const cancel = async () => {
    try {
      unwrap(await client.cancel());
      setSinglePlan(undefined);
      setQueuePlan(undefined);
      if (phase === 'confirm' || phase === 'single-confirm') setPhase('');
    } catch (error) {
      showGenerationFailure(error);
    }
  };
  const acceptQueue = (value: GenerationQueueStatus) => {
    setActive(false);
    setQueue(value.queue);
    if (
      value.latest &&
      value.latest.snapshot.project.id === project.getSnapshot().id
    ) {
      project.acceptGenerated(value.latest.snapshot);
      setSelected(value.latest.imageId);
    }
    const outcome = queueOutcome(value.queue);
    const { error } = outcome;
    setPending(outcome.pending);
    setStorageStopped(outcome.storageStopped);
    if (error) {
      showGenerationFailure(error);
    } else setMessage(value.queue?.stopped ? '중지됨' : '완료');
  };
  const prepareQueue = async (
    remaining = false,
    selectedIds = availableSceneIds,
  ) => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('save');
    setMessage('');
    setQueuePlan(undefined);
    try {
      if (!(await project.save())) return;
      const saved = project.getSnapshot();
      const prepared = unwrap(
        await (remaining
          ? client.prepareRemaining(
              queue!.id,
              saved.id!,
              saved.revision!,
              Number(intervalText),
            )
          : client.prepareQueue(
              saved.id!,
              saved.revision!,
              selectedIds,
              Number(repeats),
              Number(intervalText),
            )),
      );
      const current = unwrap(await client.queueStatus(saved.revision));
      if (current.queue?.id !== prepared.queueId)
        unwrap({
          ok: false,
          code: 'CONFIRMATION_EXPIRED',
          mayHaveReachedServer: false,
        });
      setQueue(current.queue);
      // The first save assigns a project ID and clears the transient scene selection.
      if (!view.id && !remaining) setSceneIds(selectedIds);
      setQueuePlan(prepared);
      setPhase('confirm');
    } catch (error) {
      try {
        setQueue(unwrap(await client.queueStatus()).queue);
      } catch {
        /* Keep the preparation error if metadata refresh fails. */
      }
      showGenerationFailure(error);
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase((previous) => (previous === 'confirm' ? previous : ''));
    }
  };
  const runQueue = async () => {
    if (operation.current) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('queue-run');
    setMessage('');
    const { ticket } = queuePlan!;
    setQueuePlan(undefined);
    try {
      acceptQueue(unwrap(await client.runQueue(ticket, true)));
    } catch (error) {
      showGenerationFailure(error);
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const currentFailure = queueOutcome(queue).error;
  const conflictSceneId =
    currentFailure?.code === 'QUEUE_INPUT_CHANGED'
      ? currentFailure.conflictSceneId
      : undefined;
  const excludedCount = conflictSceneId
    ? (queue?.items.filter(
        (item) => item.status === 'pending' && item.sceneId === conflictSceneId,
      ).length ?? 0)
    : 0;
  const conflict =
    conflictSceneId && excludedCount && queue?.projectId === view.id
      ? {
          sceneId: conflictSceneId,
          count: excludedCount,
          name:
            sceneNames.current.find((scene) => scene.id === conflictSceneId)
              ?.name ?? '예약 씬',
        }
      : undefined;
  const excludeConflict = async () => {
    if (operation.current || !conflict || !queue) return;
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('exclude');
    try {
      const value = unwrap(
        await client.excludePendingScene(queue.id, conflict.sceneId, true),
      );
      setQueue(value.queue);
      setQueuePlan(undefined);
      setMessage('');
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const result = images.find((i) => i.id === selected);

  const showResult = (id: string) => {
    setSelected(id);
    setMobilePane('result');
    setSidebarOpen(false);
  };
  const chooseImage = () => {
    fileInput.current?.click();
  };
  const receiveImage = (file: File) => {
    if (locked || operation.current) return;
    if (file.size === 0 || file.size > REFERENCE_LIMITS.sourceBytes) {
      setMessage('32 MiB 이하의 이미지 한 장을 선택해 주세요.');
      return;
    }
    setMessage('');
    setImageChoice(file);
  };
  const reuseResultImage = async (purpose: 'metadata' | ImagePurpose) => {
    if (locked || operation.current || !view.id || !result) return;
    if (purpose !== 'metadata') {
      await attachImage({ projectId: view.id, imageId: result.id }, purpose);
      return;
    }
    operation.current = true;
    generationEpoch.current += 1;
    setPhase('image');
    setMessage('');
    try {
      const bytes = unwrap(await client.image(view.id, result.id));
      if (
        !mounted.current ||
        project.getSnapshot().id !== view.id ||
        liveScene.current !== state.selectedSceneId
      )
        return;
      setImportFile(
        new File([new Uint8Array(bytes)], 'result.png', { type: 'image/png' }),
      );
    } catch (error) {
      setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const setResultDeleted = async (imageId: string, deleted: boolean) => {
    if (operation.current || locked || !view.id) return;
    operation.current = true;
    generationEpoch.current += 1;
    setSinglePlan(undefined);
    setQueuePlan(undefined);
    setPhase('result');
    setMessage('');
    try {
      if (!(await project.save())) return;
      const saved = project.getSnapshot();
      const reply = await projects.setImageDeleted(
        saved.id!,
        saved.revision!,
        imageId,
        deleted,
      );
      if (!reply.ok) throw new ProjectError(reply.code);
      if (!mounted.current || project.getSnapshot().id !== saved.id) return;
      project.acceptGenerated(reply.value);
      if (deleted) setLastTrashedImage({ projectId: saved.id!, imageId });
      else if (lastTrashedImage?.imageId === imageId)
        setLastTrashedImage(undefined);
    } catch (error) {
      if (error instanceof ProjectError) {
        project.reportError(error.code);
        setMessage(resultTrashOpen ? projectErrorMessage(error.code) : '');
      } else setMessage(generationMessage(error, sceneNames.current));
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      setPhase('');
    }
  };
  const emptyResultTrash = async (revision: string) => {
    if (operation.current || locked || !view.id || revision !== view.revision)
      return;
    operation.current = true;
    generationEpoch.current += 1;
    setSinglePlan(undefined);
    setQueuePlan(undefined);
    setTrashReport(undefined);
    setMessage('');
    setPhase('result');
    try {
      const reply = await projects.emptyResultTrash(view.id, revision, true);
      if (!reply.ok) throw new ProjectError(reply.code);
      if (!mounted.current || project.getSnapshot().id !== view.id) return;
      project.acceptGenerated(reply.value.snapshot);
      setLastTrashedImage(undefined);
      setTrashReport(reply.value.report);
    } catch (error) {
      if (error instanceof ProjectError) project.reportError(error.code);
      setMessage(
        error instanceof ProjectError
          ? projectErrorMessage(error.code)
          : generationMessage(error),
      );
    } finally {
      operation.current = false;
      generationEpoch.current += 1;
      if (mounted.current) setPhase('');
    }
  };
  const activeUse = (kind: PresetKind, characterId?: string) =>
    uses.find(
      (item) =>
        item.sceneId === state.selectedSceneId &&
        item.inputEpoch === view.inputEpoch &&
        item.projectId === view.id &&
        item.kind === kind &&
        item.characterId === characterId,
    );
  const mainUse = activeUse('main');
  const matchedMain = matchingPreset(presets, state.draft);
  const mainLabel =
    mainUse?.name ?? (matchedMain ? `일치: ${matchedMain.name}` : undefined);
  const mainModified =
    !!mainUse && mainUse.fingerprint !== presetTextKey(state.draft);
  const characterLabels = Object.fromEntries(
    state.draft.characters.map((c) => {
      const use = activeUse('character', c.id);
      const matched = matchingPreset(presets, state.draft, c.id);
      const fallback = matched ? `일치: ${matched.name}` : '';
      return [
        c.id,
        use
          ? `${use.name}${use.fingerprint !== presetTextKey(state.draft, c.id) ? ' · 수정됨' : ''}`
          : fallback,
      ];
    }),
  );
  const medium = state.draft.model === 'nai-diffusion-5-full-medium';
  const variation = state.draft.img2img;
  const size = draftSize(state.draft);
  const mismatchedVariation =
    !!variation &&
    (state.draft.family !== 'v5' ||
      variation.width !== size.width ||
      variation.height !== size.height);
  const inpaint = state.draft.inpaintSource;
  const canInpaint =
    state.draft.model === 'nai-diffusion-3' &&
    !state.draft.reference &&
    !variation;
  const mismatchedInpaint =
    !!inpaint &&
    (!canInpaint ||
      inpaint.width !== size.width ||
      inpaint.height !== size.height);
  let generateLabel = variation ? '변형 생성' : '이미지 생성';
  if (inpaint) generateLabel = '마스크 영역 생성';
  if (phase === 'save') generateLabel = '생성 중…';
  else if (phase === 'reference' || phase === 'image')
    generateLabel = '불러오는 중…';
  else if (phase === 'run' || phase === 'queue-run') generateLabel = '생성 중…';
  else if (pending) generateLabel = '결과 저장 필요';
  else if (singlePlan || queuePlan) generateLabel = '실행 확인 대기';
  return (
    <div
      className={`preview-workspace connected-workspace ${darkMode ? '' : 'pw-light'}`}
      data-testid="connected-workspace"
      data-mobile-pane={mobilePane}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = locked ? 'none' : 'copy';
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (!locked && event.dataTransfer.files.length === 1)
          receiveImage(event.dataTransfer.files[0]);
        else if (!locked) setMessage('이미지 한 장을 선택해 주세요.');
      }}
    >
      <header className="pw-header">
        <div className="pw-brand">
          <strong>SDStudio</strong>
          <span>이미지 작업실</span>
        </div>
        <span className="connected-connection">
          {runtimeOptions.offline ? '오프라인' : '온라인'}
        </span>
        <nav aria-label="작업실 화면">
          <button
            type="button"
            data-testid="open-vibe-editor"
            disabled={locked || runtimeOptions.offline}
            onClick={() => setVibeOpen(true)}
          >
            바이브 에디터
          </button>
          <button
            type="button"
            data-testid="open-prompt-library"
            disabled={locked}
            onClick={() => setLibraryRequest({ kind: 'main' })}
          >
            프롬프트 라이브러리
          </button>
          <button
            type="button"
            className="connected-mobile-switch"
            onClick={() =>
              setMobilePane(mobilePane === 'input' ? 'result' : 'input')
            }
          >
            {mobilePane === 'input' ? '이미지 보기' : '입력 편집'}
          </button>
          <button
            type="button"
            className="connected-sidebar-toggle"
            aria-expanded={sidebarOpen}
            aria-controls="connected-sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            결과·씬
          </button>
          <details className="connected-menu">
            <summary>메뉴</summary>
            <div>
              <button type="button" onClick={onOpenAuth}>
                API 토큰·연결 모드
              </button>
              <button type="button" onClick={onToggleTheme}>
                테마 전환
              </button>
              <button
                type="button"
                disabled={locked}
                data-testid="open-legacy-import"
                onClick={() => setLegacyImport(true)}
              >
                V3 자료 가져오기
              </button>
              <button
                type="button"
                onClick={() => onOpenLegacy('session')}
                disabled={locked}
                data-testid="open-legacy"
              >
                구 V3 작업실 열기
              </button>
            </div>
          </details>
        </nav>
      </header>
      <WorkspaceProjectControls
        controller={project}
        locked={locked}
        mode="bar"
        connected
      />
      <main className="connected-body">
        <section className="connected-input" aria-label="생성 입력">
          <div className="connected-input-scroll" data-testid="input-scroll">
            <fieldset disabled={locked}>
              <div className="connected-scene-select">
                <label htmlFor="live-scene">편집할 씬</label>
                <select
                  id="live-scene"
                  disabled={locked}
                  value={state.selectedSceneId}
                  onChange={(e) => {
                    setState((previous) =>
                      selectWorkspaceScene(previous, e.target.value),
                    );
                    setMobilePane('input');
                    setSidebarOpen(false);
                  }}
                >
                  {state.scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.name}
                    </option>
                  ))}
                </select>
              </div>
              <details>
                <summary data-testid="manage-scene">씬 관리</summary>
                <button
                  type="button"
                  disabled={
                    state.scenes.length === 1 ||
                    !!queuePlan ||
                    !!singlePlan ||
                    !!queue?.items.some(
                      (item) =>
                        item.status === 'pending' &&
                        item.sceneId === state.selectedSceneId,
                    )
                  }
                  data-testid="remove-scene"
                  onClick={() => setRemoveId(state.selectedSceneId)}
                >
                  현재 씬 제거
                </button>
                {state.scenes.length === 1 && (
                  <small>프로젝트에는 편집할 씬이 하나 필요합니다.</small>
                )}
                {removeId === state.selectedSceneId && (
                  <div>
                    <p>
                      ‘{state.scenes.find((s) => s.id === removeId)?.name}’을
                      편집 목록에서 제거할까요? 생성한 결과는 보관됩니다.
                    </p>
                    <button type="button" onClick={() => setRemoveId('')}>
                      취소
                    </button>
                    <button
                      data-testid="remove-scene-confirm"
                      type="button"
                      disabled={
                        !!queuePlan ||
                        !!singlePlan ||
                        !!queue?.items.some(
                          (item) =>
                            item.status === 'pending' &&
                            item.sceneId === removeId,
                        )
                      }
                      onClick={() => {
                        setState((old) => {
                          const next = old.scenes.find(
                            (item) => item.id !== removeId,
                          );
                          if (!next || old.selectedSceneId !== removeId)
                            return old;
                          const switched = selectWorkspaceScene(old, next.id);
                          return {
                            ...switched,
                            scenes: switched.scenes.filter(
                              (item) => item.id !== removeId,
                            ),
                          };
                        });
                        setSinglePlan(undefined);
                        setQueuePlan(undefined);
                        setRemoveId('');
                      }}
                    >
                      제거 확인
                    </button>
                  </div>
                )}
                {presetUndo?.scene === state.selectedSceneId &&
                  presetUndo.epoch === view.inputEpoch &&
                  presetUndo.after === JSON.stringify(state.draft) && (
                    <button
                      type="button"
                      onClick={() => {
                        const { before } = presetUndo;
                        setState((old) => ({
                          ...old,
                          draft: before,
                          selectedCharacter: before.characters.some(
                            (c) => c.id === old.selectedCharacter,
                          )
                            ? old.selectedCharacter
                            : (before.characters[0]?.id ?? ''),
                        }));
                        setUses((old) =>
                          old.filter(
                            (u) => u.sceneId !== state.selectedSceneId,
                          ),
                        );
                        setPresetUndo(undefined);
                        setQueuePlan(undefined);
                        setSinglePlan(undefined);
                      }}
                    >
                      ‘{presetUndo.name}’ 적용 되돌리기
                    </button>
                  )}
              </details>
              <div className="connected-model-settings">
                <ModelSizeControls
                  key={state.selectedSceneId}
                  draft={state.draft}
                  patch={patch}
                />
              </div>
              {medium && (
                <p>
                  Medium은 14스텝과 고정 부정 프리셋을 사용합니다. 편집한 부정
                  입력은 High에서 다시 사용할 수 있습니다.
                  {state.draft.reference &&
                    ' 정밀 참조를 해제하거나 High를 선택하세요.'}
                </p>
              )}
              <ConnectedReference
                reference={state.draft.reference}
                projectId={view.id}
                sceneId={state.selectedSceneId}
                family={state.draft.family}
                locked={locked}
                preview={referencePreview}
                client={client}
                onFile={async (file) => receiveImage(file)}
                onChoose={chooseImage}
                variation={state.draft.img2img}
                onVariation={(asset) => setSceneImage('img2img', asset)}
                onChange={(asset) => setSceneImage('reference', asset)}
              />
              {inpaint && (
                <fieldset disabled={locked}>
                  <legend>
                    인페인팅 · {inpaint.width}×{inpaint.height}
                  </legend>
                  <button
                    type="button"
                    disabled={mismatchedInpaint}
                    onClick={editMask}
                  >
                    {state.draft.inpaintMask
                      ? '마스크 다시 편집'
                      : '마스크 그리기'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSceneImage('inpaintSource')}
                  >
                    인페인팅 해제
                  </button>
                  {mismatchedInpaint && (
                    <p>
                      원본에 맞춰 V3 Anime · {inpaint.width}×{inpaint.height}를
                      선택하세요.
                    </p>
                  )}
                </fieldset>
              )}
              {mismatchedVariation && variation && (
                <p role="status">
                  변형 원본에 맞춰 V5 · {variation.width}×{variation.height}를
                  선택하거나 이미지를 다시 선택하세요.
                </p>
              )}
              {canUndoMetadata && (
                <button
                  type="button"
                  disabled={locked}
                  data-testid="undo-metadata"
                  onClick={() => {
                    setSinglePlan(undefined);
                    setQueuePlan(undefined);
                    setState((previous) =>
                      previous.draft === metadataUndo.after
                        ? {
                            ...previous,
                            draft: metadataUndo.before,
                            selectedCharacter:
                              metadataUndo.characterId ??
                              previous.selectedCharacter,
                          }
                        : previous,
                    );
                    if (metadataUndo.characterId !== undefined)
                      setCharacterEpoch((previous) => previous + 1);
                    setMetadataUndo(undefined);
                  }}
                >
                  가져오기 되돌리기
                </button>
              )}
              <div className="connected-metadata-entry">
                <button
                  type="button"
                  disabled={locked}
                  data-testid="main-preset"
                  onClick={() => setLibraryRequest({ kind: 'main' })}
                >
                  메인 프리셋{' '}
                  {
                    presets.filter((p) => !p.deleted && p.kind === 'main')
                      .length
                  }
                </button>
              </div>
              {mainLabel && (
                <div
                  className="preset-current"
                  data-testid="applied-main-preset"
                >
                  <span>메인 · {mainLabel}</span>
                  {mainModified && <small>수정됨</small>}
                </div>
              )}
              <div
                className="connected-prompt-tabs"
                role="group"
                aria-label="기본 프롬프트 선택"
              >
                <button
                  type="button"
                  aria-pressed={promptTab === 'prompt'}
                  onClick={() => setPromptTab('prompt')}
                >
                  기본 프롬프트
                </button>
                <button
                  type="button"
                  aria-pressed={promptTab === 'negative'}
                  onClick={() => setPromptTab('negative')}
                >
                  부정 프롬프트
                </button>
              </div>
              <label className="connected-sr-only" htmlFor="live-prompt">
                기본 프롬프트
              </label>
              <textarea
                id="live-prompt"
                data-testid="live-prompt"
                rows={11}
                hidden={promptTab !== 'prompt'}
                value={state.draft.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
              <label className="connected-sr-only" htmlFor="live-negative">
                부정 프롬프트
              </label>
              <textarea
                id="live-negative"
                rows={11}
                hidden={promptTab !== 'negative'}
                value={state.draft.negativePrompt}
                onChange={(e) => patch({ negativePrompt: e.target.value })}
              />
              <PromptPiecePanel
                key={`${view.inputEpoch}:${state.selectedSceneId}`}
                pieces={state.draft.pieces ?? []}
                disabled={locked}
                onChange={(pieces) => patch({ pieces })}
                onInsert={(piece) => {
                  const key =
                    promptTab === 'negative' ? 'negativePrompt' : 'prompt';
                  patch({
                    [key]: [state.draft[key], piece].filter(Boolean).join(', '),
                  });
                }}
              />
              <ConnectedCharacters
                key={`${view.id ?? 'draft'}:${state.selectedSceneId}:${characterEpoch}`}
                draft={state.draft}
                onChange={patch}
                presetLabels={characterLabels}
                presetCount={
                  presets.filter((p) => !p.deleted && p.kind === 'character')
                    .length
                }
                onPreset={(characterId) =>
                  setLibraryRequest({ kind: 'character', characterId })
                }
              />
              <section
                className="connected-ai-settings"
                data-testid="ai-settings"
                aria-label="생성 설정"
              >
                <h3>생성 설정</h3>
                <div className="connected-settings-fields">
                  <label htmlFor="live-seed-mode">시드 방식</label>
                  <select
                    id="live-seed-mode"
                    value={state.draft.seedMode}
                    onChange={(e) =>
                      patch({ seedMode: e.target.value as 'random' | 'fixed' })
                    }
                  >
                    <option value="random">매번 무작위</option>
                    <option value="fixed">고정</option>
                  </select>
                  <label htmlFor="live-seed">고정 시드</label>
                  <input
                    id="live-seed"
                    disabled={state.draft.seedMode !== 'fixed'}
                    value={state.draft.seed}
                    onChange={(e) => patch({ seed: e.target.value })}
                  />
                  {(state.draft.family === 'v5' || state.draft.model) && (
                    <>
                      <label htmlFor="live-steps">스텝</label>
                      <input
                        id="live-steps"
                        disabled={medium}
                        type="number"
                        min="1"
                        max="50"
                        value={medium ? '14' : state.draft.steps}
                        onChange={(e) => patch({ steps: e.target.value })}
                      />
                      <label htmlFor="live-guidance">가이던스</label>
                      <input
                        id="live-guidance"
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={state.draft.guidance}
                        onChange={(e) => patch({ guidance: e.target.value })}
                      />
                      {state.draft.family !== 'v5' && (
                        <small>
                          V5 품질 태그·부정 프리셋은 이 모델에 적용되지
                          않습니다.
                        </small>
                      )}
                      <details
                        hidden={state.draft.family !== 'v5'}
                        className="connected-extra-settings"
                      >
                        <summary>품질·부정 설정</summary>
                        <div className="connected-settings-fields">
                          <label htmlFor="live-quality">품질 태그</label>
                          <select
                            id="live-quality"
                            value={state.draft.qualityTags ?? 'none'}
                            onChange={(e) =>
                              patch({
                                qualityTags: e.target
                                  .value as WorkspaceDraft['qualityTags'],
                              })
                            }
                          >
                            <option value="none">추가 안 함</option>
                            <option value="light">Light</option>
                            <option value="standard">Standard</option>
                          </select>
                          <label htmlFor="live-uc-preset">
                            부정 프롬프트 프리셋
                          </label>
                          <select
                            id="live-uc-preset"
                            disabled={medium}
                            value={
                              medium
                                ? 'heavy'
                                : (state.draft.ucPreset ?? 'none')
                            }
                            onChange={(e) =>
                              patch({
                                ucPreset: e.target
                                  .value as WorkspaceDraft['ucPreset'],
                              })
                            }
                          >
                            <option value="none">추가 안 함</option>
                            <option value="light">Light</option>
                            <option value="heavy">Heavy</option>
                            <option value="human">Human focus</option>
                            <option value="furry">Furry focus</option>
                          </select>
                          <p>
                            품질 태그는 프롬프트 뒤에, 부정 프리셋은 부정
                            프롬프트 앞에 추가합니다. 직접 같은 태그를 쓰셨다면
                            ‘추가 안 함’을 선택하세요.
                          </p>
                        </div>
                      </details>
                    </>
                  )}
                  <p>샘플러 Euler ancestral · 스케줄 Karras</p>
                </div>
              </section>
            </fieldset>
          </div>
        </section>
        <section className="connected-results" aria-label="프로젝트 PNG 결과">
          <header className="connected-canvas-heading">
            <span>{result ? '저장된 원본 PNG' : '미리보기'}</span>
            <div
              className="connected-canvas-actions"
              aria-label="선택 이미지 작업"
            >
              {result && (
                <>
                  <button
                    type="button"
                    disabled={locked}
                    data-testid="result-use-metadata"
                    onClick={() => reuseResultImage('metadata')}
                  >
                    설정 가져오기
                  </button>
                  {canInpaint && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => reuseResultImage('inpaintSource')}
                    >
                      마스크 편집
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={locked || state.draft.family !== 'v5'}
                    data-testid="result-use-variation"
                    onClick={() => reuseResultImage('img2img')}
                  >
                    이 그림으로 변형
                  </button>
                  <button
                    type="button"
                    disabled={locked || state.draft.family !== 'v5' || medium}
                    data-testid="result-use-reference"
                    onClick={() => reuseResultImage('reference')}
                  >
                    참조로
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    data-testid="trash-result"
                    aria-label="선택 이미지 휴지통으로"
                    onClick={() => setResultDeleted(result.id, true)}
                  >
                    휴지통으로
                  </button>
                </>
              )}
              {lastTrashedImage &&
                lastTrashedImage.projectId === view.id &&
                view.trashedImages.some(
                  (i) => i.id === lastTrashedImage.imageId,
                ) && (
                  <button
                    type="button"
                    disabled={locked}
                    data-testid="undo-result-trash"
                    onClick={() =>
                      setResultDeleted(lastTrashedImage.imageId, false)
                    }
                  >
                    되돌리기
                  </button>
                )}
              <button
                type="button"
                disabled={locked}
                data-testid="open-result-trash"
                onClick={() => {
                  setMessage('');
                  setTrashReport(undefined);
                  setResultTrashOpen(true);
                }}
              >
                휴지통 {view.trashedImages.length}
              </button>
              <small>{images.length}장</small>
            </div>
          </header>
          <div className="connected-feedback">
            {singlePlan && (
              <section
                ref={singleConfirmation}
                tabIndex={-1}
                className="connected-confirm"
                aria-label="생성 사용량 확인"
                data-testid="high-steps-confirm"
              >
                <h3>사용량 확인</h3>
                {requiresAnlasWarning(singlePlan) && (
                  <p>{ANLAS_STEP_WARNING}</p>
                )}
                {singlePlan.img2img && (
                  <p>
                    이미지 변형 · 강도 {singlePlan.img2img.strength} · 노이즈{' '}
                    {singlePlan.img2img.noise}
                  </p>
                )}
                {singlePlan.reference && (
                  <p data-testid="single-reference-cost">
                    참조 1장 · 생성마다 5 Anlas 추가. 이 작업실 세션에서 처음 한
                    번 확인합니다.
                  </p>
                )}
                <p>
                  {singlePlan.model} · {singlePlan.width}×{singlePlan.height} ·{' '}
                  {singlePlan.steps}스텝 · 가이던스 {singlePlan.scale} · 시드{' '}
                  {singlePlan.seed}
                  {!!singlePlan.characters &&
                    ` · 캐릭터 ${singlePlan.characters}명 · 자동 배치`}
                </p>
                <button
                  type="button"
                  data-testid="send-high-steps"
                  onClick={confirmHighSteps}
                >
                  확인하고 생성
                </button>
                <button
                  type="button"
                  data-testid="cancel-high-steps"
                  onClick={cancel}
                >
                  취소·설정 변경
                </button>
              </section>
            )}
            {queuePlan && (
              <section
                ref={queueConfirmation}
                tabIndex={-1}
                className="connected-confirm"
                aria-label="대기열 실행 전 확인"
                data-testid="queue-confirm"
              >
                <h3>
                  총 {queuePlan.total}회 요청 · 이미지 {queuePlan.total}장 ·
                  간격 {queuePlan.intervalSeconds}초
                </h3>
                {queuePlan.settings.map((settings) => (
                  <p key={JSON.stringify(settings)}>
                    {settings.model} · {settings.width}×{settings.height} ·{' '}
                    {settings.steps}스텝 · 가이던스 {settings.scale}
                    {settings.img2img &&
                      ` · 변형 강도 ${settings.img2img.strength} · 노이즈 ${settings.img2img.noise}`}
                    {settings.reference &&
                      ` · 참조 1장 (${REFERENCE_ROLES[settings.reference.role]}, 강도 ${settings.reference.strength}${settings.reference.preferSameOutfit ? ', 같은 의상 우선' : ''})`}
                    {!!settings.characters &&
                      ` · 캐릭터 ${settings.characters}명 · 자동 배치`}
                  </p>
                ))}
                {queuePlan.settings.some((settings) => settings.reference) && (
                  <p data-testid="queue-reference-cost">
                    {REFERENCE_COST_NOTICE}
                  </p>
                )}
                {queuePlan.repeatsFixedSeed && (
                  <p>
                    고정 시드로 반복하는 씬은 조각·와일드카드도 매번 같은 선택을
                    사용합니다.
                  </p>
                )}
                {queuePlan.settings.some(requiresAnlasWarning) && (
                  <p data-testid="queue-anlas-warning">{ANLAS_STEP_WARNING}</p>
                )}
                <p>
                  아래 씬과 시드로 실행합니다. 비용·Opus 사용량은 설정에 따라
                  달라집니다. 저장 결과는 새 앱에서 읽을 수 있는 형식으로
                  보관합니다.
                </p>
                <ol>
                  {queuePlan.items.map((item) => (
                    <li key={item.id}>
                      {item.sceneName} · {item.repeat}회 · 시드 {item.seed}
                      {item.settings?.img2img &&
                        ` · I2I 강도 ${item.settings.img2img.strength}`}
                      {!!item.settings?.characters &&
                        ` · 캐릭터 ${item.settings.characters}명`}
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  data-testid="send-live-queue"
                  onClick={runQueue}
                >
                  확인한 {queuePlan.total}회 실행
                </button>
                <button type="button" onClick={cancel}>
                  취소·예약 변경
                </button>
              </section>
            )}
            {pending && (
              <section role="alert">
                <p>
                  저장하지 못한 이미지가 있습니다. 창을 닫기 전에 저장해 주세요.
                </p>
                <button
                  type="button"
                  data-testid="retry-result-save"
                  disabled={!!phase || active}
                  onClick={() => retryResult()}
                >
                  이미지 다시 저장
                </button>
                <button
                  type="button"
                  data-testid="save-result-new-project"
                  disabled={!!phase || active}
                  onClick={() => retryResult(true)}
                >
                  새 프로젝트에 저장
                </button>
                {storageStopped && (
                  <button
                    type="button"
                    disabled={!!phase || active}
                    onClick={async () => {
                      try {
                        const restarted = await projects.restartStorage();
                        if (!restarted.ok) throw restarted;
                        setStorageStopped(false);
                        setMessage('이미지 저장을 다시 선택해 주세요.');
                      } catch {
                        setMessage(
                          '저장 기능을 복구하지 못했습니다. PNG는 아직 메모리에 있습니다.',
                        );
                      }
                    }}
                  >
                    저장 기능 다시 시작
                  </button>
                )}
                <label htmlFor="discard-pending-result">
                  <input
                    id="discard-pending-result"
                    type="checkbox"
                    checked={discardConfirmed}
                    onChange={(e) => setDiscardConfirmed(e.target.checked)}
                  />
                  저장하지 않은 이미지를 버립니다.
                </label>
                <button
                  type="button"
                  disabled={!!phase || active || !discardConfirmed}
                  onClick={async () => {
                    try {
                      generationEpoch.current += 1;
                      unwrap(await client.discardPending());
                      setPending(false);
                      setMessage('');
                    } catch (error) {
                      setMessage(generationMessage(error, sceneNames.current));
                    } finally {
                      generationEpoch.current += 1;
                    }
                  }}
                >
                  미저장 결과 버리기
                </button>
              </section>
            )}
          </div>
          <div className="connected-canvas">
            {imageURL ? (
              <img
                className="connected-image"
                data-testid="generated-png"
                src={imageURL}
                alt="프로젝트에 저장된 NovelAI 생성 결과"
                onError={() =>
                  setMessage(
                    '원본 PNG는 보관됐지만 화면에서 해석하지 못했습니다. 자동으로 다시 생성하지 않습니다.',
                  )
                }
              />
            ) : (
              <div className="connected-empty">
                <strong>다음 장면을 만들어 보세요</strong>
                <span>
                  왼쪽에서 프롬프트를 쓰고 생성하세요.
                  <br />
                  저장된 이미지는 오른쪽 결과에서 다시 볼 수 있습니다.
                  <br />
                  이미지를 끌어놓으면 입력 정보를 가져올 수 있습니다.
                </span>
              </div>
            )}
          </div>
          {result && (
            <p className="connected-image-caption" data-testid="generated-seed">
              {MODELS[modelId(result.draft)]} · 시드 {result.seed}
            </p>
          )}
        </section>
        <aside
          id="connected-sidebar"
          className={`connected-sidebar ${sidebarOpen ? 'is-open' : ''}`}
          aria-label="결과와 씬·대기열"
        >
          <div className="connected-sidebar-heading">
            <strong>씬·반복</strong>
            <button
              type="button"
              className="connected-sidebar-toggle"
              aria-label="결과·씬 패널 닫기"
              onClick={() => setSidebarOpen(false)}
            >
              닫기
            </button>
          </div>
          <div
            className="connected-sidebar-scroll"
            data-testid="sidebar-scroll"
          >
            {presets.some((preset) => !preset.deleted) && (
              <section
                className="workspace-saved-presets"
                aria-label="저장한 프리셋"
              >
                <h3>저장한 프리셋</h3>
                <ul>
                  {presets
                    .filter((preset) => !preset.deleted)
                    .slice()
                    .reverse()
                    .map((preset) => (
                      <li key={preset.id}>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            setLibraryRequest({
                              kind: preset.kind,
                              initialId: preset.id,
                            })
                          }
                        >
                          <span>{preset.name}</span>
                          <small>
                            {preset.kind === 'main' ? '메인' : '캐릭터'}
                          </small>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            )}
            <SceneRecipePanel
              key={view.inputEpoch}
              presets={presets}
              base={{
                id: state.selectedSceneId,
                name: state.scenes.find((s) => s.id === state.selectedSceneId)!
                  .name,
                draft: state.draft,
              }}
              repeats={Number(repeats)}
              vibeOpen={vibeOpen}
              onVibeClose={() => setVibeOpen(false)}
              onSettings={onOpenAuth}
              onReveal={() => {
                setSidebarOpen(true);
                setMobilePane('result');
              }}
              onRepeats={(count) => {
                setRepeats(String(count));
                setQueuePlan(undefined);
              }}
              sources={state.scenes.map((s) =>
                s.id === state.selectedSceneId
                  ? { ...s, draft: state.draft }
                  : s,
              )}
              disabled={locked}
              canPrepare={!runtimeOptions.offline && intervalValid}
              onCreate={(scenes) => {
                const existing = project.content().scenes;
                const chosenIds = new Set<string>();
                const additions = scenes.filter((candidate) => {
                  const same = existing.find(
                    (s) =>
                      !chosenIds.has(s.id) &&
                      s.name === candidate.name &&
                      JSON.stringify(s.draft) ===
                        JSON.stringify(candidate.draft),
                  );
                  chosenIds.add(same?.id ?? candidate.id);
                  return !same;
                });
                if (existing.length + additions.length > PROJECT_LIMITS.scenes)
                  throw Error('프로젝트에 조합을 담을 씬 자리가 부족합니다.');
                const ids = [...chosenIds];
                flushSync(() => {
                  setState((old) => ({
                    ...old,
                    scenes: [...existing, ...additions],
                  }));
                  setSceneIds(ids);
                });
                void prepareQueue(false, ids);
              }}
            />
            <ConnectedQueueControls
              scenes={state.scenes}
              selected={availableSceneIds}
              repeats={repeats}
              intervalText={intervalText}
              onIntervalChange={(value) => {
                setIntervalText(value);
                setQueuePlan(undefined);
                if (value.trim() && isQueueInterval(Number(value)))
                  localStorage.setItem('workspace.queueIntervalSeconds', value);
              }}
              queue={queue?.projectId === view.id ? queue : undefined}
              disabled={locked}
              canPrepare={!runtimeOptions.offline && intervalValid}
              running={!!queue?.running}
              canResume={
                queue?.projectId === view.id &&
                !!queue?.items.some((item) => item.status === 'pending')
              }
              onSelection={(ids) => {
                setSceneIds(ids);
                setQueuePlan(undefined);
              }}
              onRepeats={(value) => {
                setRepeats(value);
                setQueuePlan(undefined);
              }}
              onPrepare={() => prepareQueue()}
              onResume={() => prepareQueue(true)}
              onStop={cancel}
              onClear={async () => {
                generationEpoch.current += 1;
                try {
                  unwrap(await client.clearQueue());
                  setQueue(undefined);
                  setQueuePlan(undefined);
                } catch (error) {
                  setMessage(generationMessage(error, sceneNames.current));
                } finally {
                  generationEpoch.current += 1;
                }
              }}
              conflict={conflict}
              onExclude={excludeConflict}
              hasResult={(id) => images.some((image) => image.id === id)}
              onResult={showResult}
            />
            <header className="connected-history-heading">
              <strong>결과</strong>
              <span>
                {images.length}
                {view.trashedImages.length > 0 &&
                  ` · 휴지통 ${view.trashedImages.length}`}
                {images.length + view.trashedImages.length >=
                  PROJECT_LIMITS.results - 10 && ` / ${PROJECT_LIMITS.results}`}
                {view.remainingBytes <= 40 * 1024 * 1024 &&
                  ` · 보관 여유 ${Math.floor(view.remainingBytes / (1024 * 1024))} MiB`}
              </span>
            </header>
            <div className="connected-sidebar-panel">
              <ConnectedImageHistory
                key={view.id}
                queueSceneIds={availableSceneIds}
                onPrepareMissing={
                  locked || runtimeOptions.offline || !intervalValid
                    ? undefined
                    : (ids) => void prepareQueue(false, ids)
                }
                projects={projects}
                revision={view.revision}
                scenes={state.scenes}
                client={client}
                projectId={view.id}
                images={images}
                selected={selected}
                selectedURL={imageURL}
                onSelect={showResult}
              />
            </div>
          </div>
        </aside>
      </main>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
        hidden
        aria-label="가져올 이미지"
        data-testid="metadata-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) receiveImage(file);
        }}
      />
      {maskImages && (
        <WorkspaceMaskEditor
          allowEmpty={false}
          images={maskImages}
          onClose={() => setMaskImages(undefined)}
          onSave={async (file) => !!(await attachImage(file, 'inpaintMask'))}
        />
      )}
      {imageChoice && (
        <WorkspaceImageChoice
          file={imageChoice}
          canInpaint={canInpaint}
          onInpaint={() => {
            setImageChoice(undefined);
            void attachImage(imageChoice, 'inpaintSource');
          }}
          canReference={state.draft.family === 'v5' && !medium}
          canVariation={state.draft.family === 'v5'}
          onClose={() => setImageChoice(undefined)}
          onMetadata={() => {
            setImageChoice(undefined);
            setImportFile(imageChoice);
          }}
          onVariation={() => {
            setImageChoice(undefined);
            void attachImage(imageChoice, 'img2img');
          }}
          onReference={() => {
            const file = imageChoice;
            setImageChoice(undefined);
            void attachImage(file, 'reference');
          }}
        />
      )}
      <PNGMetadataImport
        key={`${view.id ?? 'draft'}:${state.selectedSceneId}`}
        file={importFile}
        draft={state.draft}
        locked={locked}
        onClose={() => setImportFile(undefined)}
        onApply={(draft, characters) => {
          if (locked) return;
          setMetadataUndo({
            before: state.draft,
            after: draft,
            characterId: characters ? state.selectedCharacter : undefined,
            sceneId: state.selectedSceneId,
            epoch: view.inputEpoch,
          });
          setSinglePlan(undefined);
          setQueuePlan(undefined);
          setState((previous) => ({
            ...previous,
            draft,
            selectedCharacter: characters
              ? (draft.characters[0]?.id ?? '')
              : previous.selectedCharacter,
          }));
          if (characters) setCharacterEpoch((previous) => previous + 1);
          setMessage('');
        }}
      />
      {legacyImport && (
        <LegacyWorkspaceImport
          key={JSON.stringify([
            view.inputEpoch,
            state.selectedSceneId,
            legacySession?.name,
          ])}
          session={legacySession}
          pieces={state.draft.pieces ?? []}
          onPieces={(pieces) => patch({ pieces })}
          onImage={receiveImage}
          onPresets={(legacy) => {
            setLegacyImport(false);
            setLibraryRequest({kind:'main', legacy});
          }}
          onCopyMasks={(name, selectedMasks) => {
            setLegacyImport(false);
            void project.copyLegacyMasks(name, selectedMasks);
          }}
          disabled={locked}
          onClose={() => setLegacyImport(false)}
        />
      )}
      {libraryRequest && (
        <PromptLibrary
          key={`${view.id ?? 'draft'}:${state.selectedSceneId}`}
          client={window.electron.promptLibrary}
          draft={state.draft}
          kind={libraryRequest.kind}
          characterId={libraryRequest.characterId}
          locked={locked}
          onGuard={(blocked) => {
            setLibraryBlocking(blocked);
            onBusyChange(busy || blocked);
          }}
          onClose={() => setLibraryRequest(undefined)}
          onLegacy={() => onOpenLegacy('pieces')}
          initialId={libraryRequest.initialId}
          legacy={libraryRequest.legacy}
          onLibraryChange={acceptLibrary}
          onApply={(draft, characterId, preset) => {
            if (locked) return;
            setPresetUndo(
              preset
                ? {
                    scene: state.selectedSceneId,
                    epoch: view.inputEpoch,
                    before: structuredClone(state.draft),
                    after: JSON.stringify(draft),
                    name: preset.name,
                  }
                : undefined,
            );
            setSinglePlan(undefined);
            setQueuePlan(undefined);
            setState((previous) => ({
              ...previous,
              draft,
              selectedCharacter:
                characterId ??
                (draft.characters.some(
                  (c) => c.id === previous.selectedCharacter,
                )
                  ? previous.selectedCharacter
                  : (draft.characters[0]?.id ?? '')),
            }));
            if (preset)
              setUses((previous) => [
                ...previous.filter(
                  (item) =>
                    !(
                      item.sceneId === state.selectedSceneId &&
                      item.projectId === view.id &&
                      item.kind === preset.kind &&
                      item.characterId === characterId
                    ),
                ),
                {
                  ...preset,
                  characterId,
                  sceneId: state.selectedSceneId,
                  projectId: view.id,
                  fingerprint: presetTextKey(draft, characterId),
                  inputEpoch: view.inputEpoch,
                },
              ]);
            else
              setUses((previous) =>
                previous.filter(
                  (item) =>
                    item.sceneId !== state.selectedSceneId ||
                    item.projectId !== view.id,
                ),
              );
            setMessage('');
          }}
        />
      )}
      {resultTrashOpen && (
        <WorkspaceResultTrash
          client={client}
          projectId={view.id}
          error={message}
          revision={view.revision}
          report={trashReport}
          onEmpty={emptyResultTrash}
          images={view.trashedImages}
          locked={locked}
          onRestore={(id) => setResultDeleted(id, false)}
          onClose={() => {
            setResultTrashOpen(false);
            setMessage('');
          }}
        />
      )}
      <footer className="connected-action-dock" data-testid="generation-dock">
        <p role="status" data-testid="generation-status">
          {phase === 'run' || phase === 'queue-run' ? '' : message}
        </p>
        {capacity && !pending && (
          <button
            type="button"
            data-testid="generation-capacity-copy"
            disabled={locked}
            onClick={() => project.copy(true)}
          >
            입력만 새 프로젝트로
          </button>
        )}
        {(phase === 'run' || phase === 'queue-run') && (
          <button
            type="button"
            className="connected-stop"
            data-testid="cancel-generation"
            onClick={cancel}
          >
            중지 · 현재 요청 취소
          </button>
        )}
        <button
          type="button"
          className="pw-generate"
          data-testid="prepare-generation"
          disabled={
            locked ||
            runtimeOptions.offline ||
            characterOverflow ||
            mismatchedVariation ||
            mismatchedInpaint ||
            (!!inpaint && !state.draft.inpaintMask)
          }
          onClick={prepare}
        >
          {generateLabel}
          {state.draft.reference && (
            <span
              className="connected-cost-badge"
              data-testid="reference-cost-badge"
            >
              참조 +5 Anlas
            </span>
          )}
        </button>
        <small>
          {phase === 'run' || phase === 'queue-run'
            ? '진행 중'
            : '현재 씬 · 1장'}
        </small>
      </footer>
    </div>
  );
}

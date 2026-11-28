import {
  ProjectError,
  remainingProjectBytes,
  PROJECT_LIMITS,
} from '../../workspaceProject';
import { REFERENCE_COUNT_NOTICE } from '../../workspaceReference';
import type {
  LegacyScenePage,
  ProjectClient,
  ProjectContent,
  ProjectSnapshot,
  ProjectListing,
  ProjectImage,
  ProjectErrorCode,
  ProjectReply,
} from '../../workspaceProject';
import { snapshotWorkspaceScenes } from '../preview/workspaceDraft';
import type { WorkspaceState } from '../preview/workspaceDraft';

export const projectErrorMessage = (code: ProjectErrorCode): string =>
  ({
    PROJECT_INPUT:
      '프로젝트 입력 형식을 확인해 주세요. 현재 편집은 유지됩니다.',
    PROJECT_VERSION:
      '더 새로운 형식입니다. 원본을 수정하지 않습니다. 이력에서 별도 복사본을 복구할 수 있습니다.',
    PROJECT_CORRUPT:
      '프로젝트 형식 또는 일부 이미지 파일이 없거나 다릅니다. 최근 생성은 정상 저장됐을 수 있습니다. 원본을 보존하고 유효한 이력의 복사 복구를 확인해 주세요. 분실된 PNG는 이력만으로 복원할 수 없습니다.',
    PROJECT_NOT_FOUND: '프로젝트를 찾지 못했습니다. 목록을 새로 확인해 주세요.',
    PROJECT_CONFLICT:
      '다른 저장이 반영됐을 수 있습니다. 현재 편집을 유지한 채 다시 열거나 입력만 새 프로젝트로 저장하세요.',
    PROJECT_BUSY:
      '다른 저장 또는 이전 종료의 잠금이 남아 있습니다. 잠금을 지우지 않고 새 복사본으로 계속할 수 있습니다.',
    PROJECT_SERVICE_STOPPED:
      '저장 기능이 중지됐습니다. 입력은 유지됩니다. 저장 기능 다시 시작 후 목록을 확인하세요. 이전 저장은 자동 재시도하지 않습니다.',
    PROJECT_IO:
      '저장 결과를 확정하지 못했습니다. 교체됐을 수도 있으니 다시 열어 확인하세요. 현재 편집은 유지됩니다.',
    PROJECT_REFERENCE_COUNT: REFERENCE_COUNT_NOTICE,
    PROJECT_IMAGE_TOO_LARGE:
      '전송용 PNG가 5 MiB를 초과합니다. 다른 이미지를 선택하세요.',
    PROJECT_LEGACY_SCENE:
      '활성 후보가 없는 슬롯이 있습니다. 복사할 씬의 슬롯을 확인하세요.',
    PROJECT_LEGACY_PIECE:
      '슬롯이 참조하는 조각을 읽을 수 없습니다. 원본 세션에서 조각 이름과 내용을 확인하세요.',
    PROJECT_LEGACY_PICK:
      '선별 PNG를 읽을 수 없습니다. 원본 파일을 확인하거나 선별 PNG 포함을 해제하고 다시 복사하세요.',
    PROJECT_LEGACY_MASK:
      'V3 세션의 인페인팅 씬을 복사할 수 없습니다. 저장된 원본과 같은 크기의 PNG 마스크가 있고, 마스크에 칠한 영역이 있는지 확인하세요.',
    PROJECT_LIMIT:
      '보관 한도에 도달했습니다. 이력을 지우지 않고 새 복사본으로 계속하거나 입력만 새 프로젝트로 저장하세요.',
    PROJECT_RESULT_LIMIT:
      '휴지통을 포함해 결과는 120장까지 보관할 수 있습니다. 요청한 장수를 담을 자리가 부족합니다.',
    PROJECT_GENERATION_SPACE:
      '결과·참조 자산의 256 MiB 한도에서 다음 PNG에 필요한 여유 공간 32 MiB를 확보할 수 없습니다.',
    PROJECT_HISTORY_LIMIT:
      '이 프로젝트의 저장 이력 1,000개를 모두 사용했습니다.',
    PROJECT_UNTRUSTED: '현재 창에서는 프로젝트에 접근할 수 없습니다.',
  })[code];
function unwrap<T>(reply: ProjectReply<T>): T {
  if (!reply.ok) throw new ProjectError(reply.code);
  return reply.value;
}
export interface ProjectView {
  inputEpoch: number;
  name: string;
  id?: string;
  revision?: string;
  baseline: string;
  images: number;
  remainingBytes: number;
  imageRecords: ProjectImage[];
  trashedImages: ProjectImage[];
  showTrash: boolean;
  lastTrashedProject?: ProjectListing;
  operation: string;
  message: string;
  legacyCopyNotice?: string;
  error?: ProjectErrorCode;
  panel: boolean;
  projects: ProjectListing[];
  history: string[];
  target: string;
  confirm?: string;
}
interface Options {
  client?: ProjectClient;
  workspace: () => WorkspaceState;
  busy: () => boolean;
  apply: (snapshot: ProjectSnapshot) => void;
  reset: () => void;
}
export class ProjectController {
  private state: ProjectView;

  private listeners = new Set<() => void>();

  private continuation?: () => Promise<void>;

  private cancelled?: () => void;

  constructor(private readonly options: Options) {
    this.state = {
      inputEpoch: 0,
      name: '새 프로젝트',
      baseline: '',
      images: 0,
      remainingBytes: PROJECT_LIMITS.totalPNGBytes,
      imageRecords: [],
      trashedImages: [],
      showTrash: false,
      operation: '',
      message: '입력·씬은 명시적으로 저장합니다. 예제 SVG·대기열은 임시입니다.',
      panel: false,
      projects: [],
      history: [],
      target: '',
    };
    this.state.baseline = this.fingerprint();
  }

  getSnapshot = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private update(patch: Partial<ProjectView>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  content(): ProjectContent {
    return {
      name: this.state.name,
      selectedSceneId: this.options.workspace().selectedSceneId,
      scenes: snapshotWorkspaceScenes(this.options.workspace()),
    };
  }

  private fingerprint() {
    return JSON.stringify(this.content());
  }

  dirty() {
    return this.fingerprint() !== this.state.baseline;
  }

  reportError(code: ProjectErrorCode) {
    this.update({ error: code, message: projectErrorMessage(code) });
  }

  available() {
    return !!this.options.client;
  }

  setName(name: string) {
    if (!this.state.operation) this.update({ name });
  }

  private async execute(label: string, action: () => Promise<void>) {
    if (this.state.operation || this.options.busy()) {
      this.update({
        message: '예약·실행 중인 작업을 마치거나 비운 뒤 진행해 주세요.',
      });
      return false;
    }
    this.update({
      operation: label,
      error: undefined,
      legacyCopyNotice: undefined,
    });
    try {
      await action();
      return true;
    } catch (error) {
      const code = error instanceof ProjectError ? error.code : 'PROJECT_IO';
      this.update({ error: code, message: projectErrorMessage(code) });
      return false;
    } finally {
      this.update({ operation: '' });
    }
  }

  private client() {
    if (!this.options.client) throw new ProjectError('PROJECT_UNTRUSTED');
    return this.options.client;
  }

  private bind(snapshot: ProjectSnapshot, baseline: string) {
    this.update({
      id: snapshot.project.id,
      revision: snapshot.revision,
      remainingBytes: remainingProjectBytes(snapshot.project),
      images: snapshot.project.images.filter(
        (image) => !snapshot.project.trashedImageIds?.includes(image.id),
      ).length,
      imageRecords: structuredClone(
        snapshot.project.images.filter(
          (image) => !snapshot.project.trashedImageIds?.includes(image.id),
        ),
      ),
      trashedImages: structuredClone(
        snapshot.project.images.filter((image) =>
          snapshot.project.trashedImageIds?.includes(image.id),
        ),
      ),
      baseline,
      legacyCopyNotice: undefined,
      message:
        '입력·씬 저장됨 · 기존 PNG 기록 유지 · 대기열은 저장하지 않습니다.',
      error: undefined,
    });
  }

  acceptGenerated(snapshot: ProjectSnapshot, asNewProject = false) {
    if (snapshot.project.id !== this.state.id) {
      if (!asNewProject) throw new ProjectError('PROJECT_CONFLICT');
      this.options.apply(snapshot);
      this.update({
        inputEpoch: this.state.inputEpoch + 1,
        name: snapshot.project.name,
      });
    }
    const { name, selectedSceneId, scenes } = snapshot.project;
    this.bind(snapshot, JSON.stringify({ name, selectedSceneId, scenes }));
    if (this.dirty())
      this.update({
        message:
          '생성 결과를 저장했습니다. 현재 편집과 저장된 입력이 달라 미저장 상태로 유지합니다.',
      });
  }

  async restartStorage() {
    return this.execute('저장 기능 다시 시작 중', async () => {
      unwrap(await this.client().restartStorage());
      this.update({
        message:
          '저장 기능을 다시 시작했습니다. 이전 저장의 완료 여부는 목록/열기로 확인하세요. 이전 요청은 다시 보내지 않았습니다. 저장이 중간에 끊겼다면 새 복사본으로 계속해야 할 수 있습니다.',
        error: undefined,
      });
    });
  }

  async save() {
    return this.execute('저장 중', async () => {
      const content = this.content();
      const baseline = JSON.stringify(content);
      const result = this.state.id
        ? await this.client().save(this.state.id, this.state.revision!, content)
        : await this.client().create(content);
      this.bind(unwrap(result), baseline);
    });
  }

  async copy(inputOnly = false) {
    return this.execute('복사 중', async () => {
      const content = this.content();
      const baseline = JSON.stringify(content);
      const result =
        !inputOnly && this.state.id
          ? await this.client().copy(
              this.state.id,
              this.state.revision!,
              content,
            )
          : await this.client().create(content, this.state.id);
      this.bind(unwrap(result), baseline);
      this.update({
        message: inputOnly
          ? '입력·씬만 새 프로젝트에 저장했습니다. 이전 PNG는 복사하지 않았습니다.'
          : '새 복사본에 저장했습니다. 원본·이력·잠금은 그대로입니다.',
      });
    });
  }

  async list(showTrash = false) {
    this.update({ panel: true, showTrash, target: '', history: [] });
    return this.execute('목록 읽는 중', async () => {
      this.update({
        projects: unwrap(
          await (showTrash ? this.client().listTrash() : this.client().list()),
        ),
      });
    });
  }

  closePanel() {
    if (!this.state.operation) this.update({ panel: false });
  }

  async inspect(id: string) {
    return this.execute('이력 읽는 중', async () => {
      this.update({
        target: id,
        history: unwrap(await this.client().history(id)),
        message: '목록 정보만 확인했습니다. 열 때 PNG 무결성을 검사합니다.',
      });
    });
  }

  private async replace(snapshot: ProjectSnapshot) {
    if (this.options.busy()) throw new ProjectError('PROJECT_BUSY');
    this.options.apply(snapshot);
    const content = {
      name: snapshot.project.name,
      selectedSceneId: snapshot.project.selectedSceneId,
      scenes: snapshot.project.scenes,
    };
    this.update({
      inputEpoch: this.state.inputEpoch + 1,
      name: content.name,
      panel: false,
      target: '',
      history: [],
    });
    this.bind(snapshot, JSON.stringify(content));
  }

  private async guard(
    label: string,
    action: () => Promise<void>,
    cancelled?: () => void,
  ) {
    if (this.state.confirm || this.state.operation || this.options.busy()) {
      cancelled?.();
      this.update({ message: '현재 작업 또는 확인을 마친 뒤 진행해 주세요.' });
      return;
    }
    if (this.dirty()) {
      this.continuation = action;
      this.cancelled = cancelled;
      this.update({ confirm: label });
      return;
    }
    await action();
  }

  private resetInput() {
    this.options.reset();
    const initial = this.options.workspace();
    this.update({
      inputEpoch: this.state.inputEpoch + 1,
      id: undefined,
      revision: undefined,
      name: '새 프로젝트',
      images: 0,
      remainingBytes: PROJECT_LIMITS.totalPNGBytes,
      imageRecords: [],
      trashedImages: [],
      showTrash: false,
      panel: false,
      error: undefined,
      baseline: JSON.stringify({
        name: '새 프로젝트',
        selectedSceneId: initial.selectedSceneId,
        scenes: snapshotWorkspaceScenes(initial),
      }),
      message: '새 입력입니다. 저장 버튼을 눌러 보관하세요.',
    });
  }

  async newProject() {
    return this.guard('새 입력 시작', async () => {
      this.resetInput();
    });
  }

  async trashProject(id: string) {
    const move = async () => {
      await this.execute('휴지통으로 이동 중', async () => {
        const entry =
          this.state.id === id
            ? { id, name: this.state.name }
            : (this.state.projects.find((p) => p.id === id) ?? { id });
        unwrap(await this.client().trashProject(id));
        if (this.state.id === id) this.resetInput();
        this.update({
          lastTrashedProject: entry,
          target: '',
          history: [],
          projects: unwrap(await this.client().list()),
        });
      });
    };
    if (this.state.id === id) return this.guard('프로젝트 휴지통 이동', move);
    return move();
  }

  async purgeProject(id: string) {
    return this.execute('영구 삭제 중', async () => {
      if (!this.state.showTrash) throw new ProjectError('PROJECT_INPUT');
      try {
        unwrap(await this.client().purgeProject(id, true));
        if (this.state.lastTrashedProject?.id === id)
          this.update({ lastTrashedProject: undefined });
      } finally {
        const projects = unwrap(await this.client().listTrash());
        this.update({ projects });
        if (
          this.state.lastTrashedProject?.id === id &&
          !projects.some((entry) => entry.id === id && !entry.deleting)
        )
          this.update({ lastTrashedProject: undefined });
      }
    });
  }

  async restoreProject(id: string, open = false) {
    const restore = async () => {
      await this.execute('프로젝트 복원 중', async () => {
        unwrap(await this.client().restoreProject(id));
        if (this.state.lastTrashedProject?.id === id)
          this.update({ lastTrashedProject: undefined });
        if (open) await this.replace(unwrap(await this.client().open(id)));
        else
          this.update({
            projects: unwrap(
              await (this.state.showTrash
                ? this.client().listTrash()
                : this.client().list()),
            ),
          });
      });
    };
    if (open) return this.guard('복원한 프로젝트 열기', restore);
    return restore();
  }

  async open(id: string) {
    return this.guard('다른 프로젝트 열기', async () => {
      await this.execute('프로젝트 읽는 중', async () =>
        this.replace(unwrap(await this.client().open(id))),
      );
    });
  }

  async copyLegacyScene(
    name: string,
    key: string,
    withPicks: boolean,
    page?: LegacyScenePage,
  ) {
    return this.guard('V3 일반 씬을 새 프로젝트로 복사', async () => {
      await this.execute('슬롯 조합과 선별 PNG 복사 중', async () => {
        const snapshot = unwrap(
          await this.client().copyLegacyScene(name, key, withPicks, page),
        );
        await this.replace(snapshot);
        this.update({
          legacyCopyNotice: `공통 프리셋은 별도로 적용하세요. 복사한 씬의 부정 프롬프트는 비어 있습니다.`,
          message: `슬롯 조합 ${snapshot.project.scenes.length}개와 선별 PNG ${snapshot.project.images.length}장을 복사했습니다.`,
        });
      });
    });
  }

  async copyLegacyMasks(name: string, selected?: string[]) {
    return this.guard('V3 마스크 씬을 새 프로젝트로 복사', async () => {
      await this.execute('저장된 마스크 씬 복사 중', async () => {
        const copy = unwrap(
          await this.client().copyLegacyMasks(name, selected),
        );
        if ('failedScene' in copy) {
          this.update({
            error: 'PROJECT_LEGACY_MASK',
            message: `「${copy.failedScene}」 씬의 입력을 복사할 수 없습니다. V3 자료 가져오기에서 이 씬의 선택을 해제하거나 원본과 마스크를 확인하세요.`,
          });
          return;
        }
        await this.replace(copy);
        this.update({
          message: `V3 마스크 씬 ${copy.project.scenes.length}개를 새 프로젝트에 복사했습니다.`,
        });
      });
    });
  }

  async recover(id: string, revision: string) {
    return this.guard('이력에서 새 복사본 복구', async () => {
      await this.execute('복구 중', async () =>
        this.replace(unwrap(await this.client().recover(id, revision))),
      );
    });
  }

  async confirm(choice: 'save' | 'discard' | 'cancel') {
    const next = this.continuation;
    const cancel = this.cancelled;
    if (!next) return;
    if (choice === 'save' && !(await this.save())) return;
    this.continuation = undefined;
    this.cancelled = undefined;
    this.update({ confirm: undefined });
    if (choice === 'cancel') {
      cancel?.();
      return;
    }
    await next();
  }

  async prepareLeave(): Promise<boolean> {
    return new Promise((resolve) => {
      this.guard(
        '앱 닫기 / 재시작',
        async () => {
          resolve(!this.options.busy() && !this.state.operation);
        },
        () => resolve(false),
      );
    });
  }
}

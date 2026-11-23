import { ProjectError } from '../../workspaceProject';
import type {
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
    PROJECT_LIMIT:
      '보관 한도에 도달했습니다. 이력을 지우지 않고 새 복사본으로 계속하거나 입력만 새 프로젝트로 저장하세요.',
    PROJECT_UNTRUSTED: '현재 창에서는 프로젝트에 접근할 수 없습니다.',
  })[code];
function unwrap<T>(reply: ProjectReply<T>): T {
  if (!reply.ok) throw new ProjectError(reply.code);
  return reply.value;
}
export interface ProjectView {
  name: string;
  id?: string;
  revision?: string;
  baseline: string;
  images: number;
  imageRecords: ProjectImage[];
  operation: string;
  message: string;
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
      name: '새 프로젝트',
      baseline: '',
      images: 0,
      imageRecords: [],
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
    this.update({ operation: label, error: undefined });
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
      images: snapshot.project.images.length,
      imageRecords: structuredClone(snapshot.project.images),
      baseline,
      message:
        '입력·씬 저장됨 · 기존 PNG 기록 유지 · 대기열은 저장하지 않습니다.',
      error: undefined,
    });
  }

  acceptGenerated(snapshot: ProjectSnapshot, asNewProject = false) {
    if (snapshot.project.id !== this.state.id) {
      if (!asNewProject) throw new ProjectError('PROJECT_CONFLICT');
      this.options.apply(snapshot);
      this.update({ name: snapshot.project.name });
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
          : await this.client().create(content);
      this.bind(unwrap(result), baseline);
      this.update({
        message: inputOnly
          ? '입력·씬만 새 프로젝트에 저장했습니다. 이전 PNG는 복사하지 않았습니다.'
          : '새 복사본에 저장했습니다. 원본·이력·잠금은 그대로입니다.',
      });
    });
  }

  async list() {
    this.update({ panel: true });
    return this.execute('목록 읽는 중', async () => {
      this.update({ projects: unwrap(await this.client().list()) });
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
    this.update({ name: content.name, panel: false, target: '', history: [] });
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

  async newProject() {
    return this.guard('새 입력 시작', async () => {
      this.options.reset();
      const initial = this.options.workspace();
      this.update({
        id: undefined,
        revision: undefined,
        name: '새 프로젝트',
        images: 0,
        imageRecords: [],
        panel: false,
        error: undefined,
        baseline: JSON.stringify({
          name: '새 프로젝트',
          selectedSceneId: initial.selectedSceneId,
          scenes: snapshotWorkspaceScenes(initial),
        }),
        message: '새 입력입니다. 저장 버튼을 눌러 보관하세요.',
      });
    });
  }

  async open(id: string) {
    return this.guard('다른 프로젝트 열기', async () => {
      await this.execute('프로젝트 읽는 중', async () =>
        this.replace(unwrap(await this.client().open(id))),
      );
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

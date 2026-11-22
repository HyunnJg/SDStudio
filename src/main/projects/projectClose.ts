/* eslint import/prefer-default-export: off */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
// Renderer must explicitly finish after its project decision and legacy save have completed.
export class ProjectCloseCoordinator {
  private pending = false;

  private approved = false;

  private rendererState?: 'gone' | 'unresponsive';

  private deciding = false;

  private generation = 0;

  private readonly askWithoutRenderer?: (
    state: 'gone' | 'unresponsive',
  ) => Promise<boolean>;

  private readonly requestRenderer: () => void;

  private readonly closeWindow: () => void;

  constructor(
    requestRenderer: () => void,
    closeWindow: () => void,
    askWithoutRenderer?: (state: 'gone' | 'unresponsive') => Promise<boolean>,
  ) {
    this.requestRenderer = requestRenderer;
    this.closeWindow = closeWindow;
    this.askWithoutRenderer = askWithoutRenderer;
  }

  reset() {
    this.pending = false;
    this.approved = false;
    this.rendererState = undefined;
    this.deciding = false;
    this.generation += 1;
  }

  setRendererState(state?: 'gone' | 'unresponsive') {
    this.rendererState = state;
    if (state) this.pending = false;
  }

  request() {
    if (this.approved) return true;
    if (this.rendererState) {
      if (this.deciding || !this.askWithoutRenderer) return false;
      this.deciding = true;
      const { generation } = this;
      const state = this.rendererState;
      Promise.resolve()
        .then(() => this.askWithoutRenderer!(state))
        .then((approved) => {
          if (!approved || generation !== this.generation) return false;
          this.approved = true;
          this.closeWindow();
          return true;
        })
        .catch(() => {
          /* Dialog failure must never approve data loss. */
        })
        .finally(() => {
          if (generation === this.generation) this.deciding = false;
        })
        .catch(() => {
          /* Final cleanup must not produce an unhandled rejection. */
        });
      return false;
    }
    this.pending = true;
    this.requestRenderer();
    return false;
  }

  finish() {
    if (!this.pending || this.rendererState) return false;
    this.approved = true;
    this.closeWindow();
    return true;
  }

  cancel() {
    this.pending = false;
  }

  register(
    ipc: Pick<IpcMain, 'handle'>,
    trusted: (event: IpcMainInvokeEvent) => boolean,
  ) {
    ipc.handle(
      'workspace-close-finish',
      (event) => trusted(event) && this.finish(),
    );
    ipc.handle('workspace-close-cancel', (event) => {
      if (!trusted(event)) return false;
      this.cancel();
      return true;
    });
  }
}

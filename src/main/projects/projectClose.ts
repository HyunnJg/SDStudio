/* eslint import/prefer-default-export: off */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
// Renderer must explicitly finish after its project decision and legacy save have completed.
export class ProjectCloseCoordinator {
  private pending = false;

  private approved = false;

  private readonly requestRenderer: () => void;

  private readonly closeWindow: () => void;

  constructor(requestRenderer: () => void, closeWindow: () => void) {
    this.requestRenderer = requestRenderer;
    this.closeWindow = closeWindow;
  }

  reset() {
    this.pending = false;
    this.approved = false;
  }

  request() {
    if (this.approved) return true;
    this.pending = true;
    this.requestRenderer();
    return false;
  }

  finish() {
    if (!this.pending) return false;
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

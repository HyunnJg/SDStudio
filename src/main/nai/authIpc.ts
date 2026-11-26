import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type { NaiAuthResult } from '../../naiAuth';
import { NaiError } from './errors';
import { NaiTokenStore } from './tokenStore';

export function isTrustedAuthFrame(
  event: IpcMainInvokeEvent,
  contents: WebContents | undefined,
  expectedURL: string,
): boolean {
  if (
    !contents ||
    event.sender !== contents ||
    event.senderFrame !== contents.mainFrame
  )
    return false;
  try {
    const actual = new URL(event.senderFrame.url);
    const expected = new URL(expectedURL);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname &&
      !actual.username &&
      !actual.password
    );
  } catch {
    return false;
  }
}

export function registerNaiAuth(
  ipc: Pick<IpcMain, 'handle'>,
  store: NaiTokenStore,
  offline: () => boolean,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  namespace: 'nai-auth' | 'gemini-auth' = 'nai-auth',
): void {
  const handle = (
    channel: string,
    action: (...args: unknown[]) => ReturnType<NaiTokenStore['status']>,
  ) => {
    ipc.handle(channel, async (event, ...args): Promise<NaiAuthResult> => {
      try {
        if (!trusted(event)) throw new NaiError('UNTRUSTED_SENDER');
        if (offline()) throw new NaiError('OFFLINE');
        const status = await action(...args);
        if (!trusted(event)) throw new NaiError('UNTRUSTED_SENDER');
        if (offline()) throw new NaiError('OFFLINE');
        return { ok: true, status };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof NaiError ? error.code : 'STORE_UNREADABLE',
        };
      }
    });
  };
  handle(`${namespace}-status`, () => store.status());
  handle(`${namespace}-set`, (token, remember) => store.set(token, remember));
  handle(`${namespace}-clear`, () => store.clear());
  handle(`${namespace}-check`, async () => {
    await store.read();
    return { ...(await store.status()), locallyReadable: true };
  });
}

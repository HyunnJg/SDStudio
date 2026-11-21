/* eslint import/prefer-default-export: off */
import type { Session } from 'electron';
import { allowsOfflineURL } from '../runtimeOptions';

export function installOfflineRequestGuard(target: Session): void {
  target.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: !allowsOfflineURL(details.url) }),
  );
}

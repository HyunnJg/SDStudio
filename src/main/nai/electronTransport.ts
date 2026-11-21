/* eslint import/prefer-default-export: off */
import { net, session } from 'electron';
import { NaiTransport } from './transport';
import type { NaiTokenStore } from './tokenStore';

// defaultSession is the same session protected by main.ts's offline webRequest hook.
export function createNaiTransport(
  store: NaiTokenStore,
  offline: () => boolean,
) {
  return new NaiTransport({
    request: (options) => net.request(options),
    session: session.defaultSession,
    offline,
    token: () => store.read(),
  });
}

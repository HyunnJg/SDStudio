import { createRuntimeOptions } from '../runtimeOptions';

export const runtimeOptions =
  (typeof window !== 'undefined' && window.electron?.runtime) ||
  createRuntimeOptions({
    SDSTUDIO_MOCK_BACKEND: process.env.SDSTUDIO_MOCK_BACKEND,
    SDSTUDIO_OFFLINE: process.env.SDSTUDIO_OFFLINE,
  });

export function selectBackend<T>(
  mock: boolean,
  electron: boolean,
  factories: { mock: () => T; electron: () => T; android: () => T },
): T {
  if (mock) return factories.mock();
  return electron ? factories.electron() : factories.android();
}

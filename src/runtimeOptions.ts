export interface RuntimeOptions {
  offline: boolean;
  mockBackend: boolean;
}

export function createRuntimeOptions(
  env: Record<string, string | undefined>,
  isolated = false,
): RuntimeOptions {
  const mockBackend = env.SDSTUDIO_MOCK_BACKEND === '1';
  return {
    mockBackend,
    offline:
      mockBackend ||
      env.SDSTUDIO_OFFLINE === '1' ||
      (isolated && env.SDSTUDIO_OFFLINE !== '0'),
  };
}

export function allowsOfflineURL(value: string): boolean {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

import fs from 'fs';
import path from 'path';
import { projectCheck } from '../../workspaceProject';

export type ReadFile = (filename: string, limit: number) => Uint8Array;

export function record(value: unknown): Record<string, unknown> {
  projectCheck(
    value && typeof value === 'object' && !Array.isArray(value),
    'PROJECT_INPUT',
  );
  return value as Record<string, unknown>;
}

export function component(value: unknown): asserts value is string {
  projectCheck(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 180 &&
      !/[\\/:*?"<>|]/.test(value) &&
      Array.from(value).every((c) => c.charCodeAt(0) >= 32) &&
      !/[. ]$/.test(value) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value),
  );
}

export function readLegacySession(
  root: string,
  sessionName: string,
  read: ReadFile,
) {
  component(sessionName);
  const base = fs.realpathSync(root);
  const load = (parts: string[], limit: number) => {
    parts.forEach(component);
    let folder = base;
    parts.slice(0, -1).forEach((part) => {
      folder = path.join(folder, part);
      const st = fs.lstatSync(folder);
      projectCheck(st.isDirectory() && !st.isSymbolicLink(), 'PROJECT_CORRUPT');
    });
    return read(path.join(folder, parts[parts.length - 1]), limit);
  };
  const bytes = load(['projects', `${sessionName}.json`], 32 * 1024 * 1024);
  const session = record(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  );
  projectCheck(
    session.version === undefined ||
      session.version === 0 ||
      session.version === 1,
    'PROJECT_VERSION',
  );
  return { session, load };
}

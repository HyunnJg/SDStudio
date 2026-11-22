/* eslint import/prefer-default-export: off, no-bitwise: off -- POSIX private permissions. */
import fs from 'fs/promises';
import path from 'path';
import type { NaiResponseInfo } from './transport';
import { describeResponseMediaType } from './responseMediaType';

// One bounded, private observation per profile. Best effort; never changes request success.
export function firstGenerationObserver(profile: string) {
  let observed = false;
  return (info: Readonly<NaiResponseInfo>) => {
    if (observed) return;
    observed = true;
    const media =
      info.mediaTypeState === 'present'
        ? describeResponseMediaType(info.mediaType)
        : {
            mediaTypeState:
              info.mediaTypeState === 'absent' ? 'absent' : 'invalid',
          };
    const data = { version: 1, httpStatus: info.httpStatus, ...media };
    const write = async () => {
      const folder = path.join(profile, 'nai-diagnostics');
      await fs.mkdir(folder, { mode: 0o700 });
      return folder;
    };
    write()
      .catch(async (error) => {
        if (error.code !== 'EEXIST') throw error;
        return path.join(profile, 'nai-diagnostics');
      })
      .then(async (folder) => {
        const stat = await fs.lstat(folder);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (process.platform !== 'win32' &&
            ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()))
        )
          return undefined;
        await fs.writeFile(
          path.join(folder, 'first-response.v1.json'),
          JSON.stringify(data),
          { flag: 'wx', mode: 0o600 },
        );
        return undefined;
      })
      .catch(() => {
        /* Diagnostics never affect result or retry policy. */
      });
  };
}

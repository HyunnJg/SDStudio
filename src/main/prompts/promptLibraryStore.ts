/* eslint import/prefer-default-export: off, no-bitwise: off, no-await-in-loop: off -- Bounded sequential reads with explicit native flags. */
import { constants } from 'fs';
import * as fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  LibraryError,
  libraryCheck,
  libraryId,
  validatePreset,
  LIBRARY_LIMITS,
} from '../../promptLibrary';
import type {
  LibrarySnapshot,
  PresetContent,
  PromptPreset,
} from '../../promptLibrary';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export class PromptLibraryStore {
  private readonly directory: string;

  private readonly file: string;

  private tail: Promise<unknown> = Promise.resolve();

  constructor(profile: string) {
    this.directory = path.join(profile, 'prompt-library');
    this.file = path.join(this.directory, 'library.v1.json');
  }

  private async load(): Promise<LibrarySnapshot> {
    try {
      await fs.mkdir(this.directory, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
    const directory = await fs.lstat(this.directory);
    libraryCheck(
      directory.isDirectory() && !directory.isSymbolicLink(),
      'LIBRARY_CORRUPT',
    );
    let before;
    try {
      before = await fs.lstat(this.file);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT')
        return { revision: digest(Buffer.alloc(0)), entries: [] };
      throw error;
    }
    libraryCheck(
      before.isFile() && !before.isSymbolicLink(),
      'LIBRARY_CORRUPT',
    );
    let handle;
    try {
      handle = await fs.open(
        this.file,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW || 0) |
          (constants.O_NONBLOCK || 0),
      );
    } catch (error) {
      throw new LibraryError('LIBRARY_CORRUPT');
    }
    try {
      const stat = await handle.stat();
      libraryCheck(
        before.isFile() &&
          !before.isSymbolicLink() &&
          stat.isFile() &&
          before.ino === stat.ino &&
          before.dev === stat.dev &&
          stat.size <= LIBRARY_LIMITS.bytes,
        'LIBRARY_CORRUPT',
      );
      const bytes = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const r = await handle.read(bytes, size, bytes.length - size, size);
        if (!r.bytesRead) break;
        size += r.bytesRead;
      }
      libraryCheck(size === stat.size, 'LIBRARY_CORRUPT');
      const body = bytes.subarray(0, size);
      let parsed;
      try {
        parsed = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(body),
        );
      } catch {
        throw new LibraryError('LIBRARY_CORRUPT');
      }
      libraryCheck(
        parsed && parsed.format === 'sdstudio-prompt-library',
        'LIBRARY_CORRUPT',
      );
      libraryCheck(parsed.version === 1, 'LIBRARY_VERSION');
      libraryCheck(
        Object.keys(parsed).length === 3 &&
          Array.isArray(parsed.entries) &&
          parsed.entries.length <= LIBRARY_LIMITS.entries,
        'LIBRARY_CORRUPT',
      );
      const ids = new Set();
      parsed.entries.forEach((p: PromptPreset) => {
        try {
          validatePreset(p, true);
        } catch {
          throw new LibraryError('LIBRARY_CORRUPT');
        }
        libraryCheck(!ids.has(p.id), 'LIBRARY_CORRUPT');
        ids.add(p.id);
      });
      return { revision: digest(body), entries: parsed.entries };
    } finally {
      await handle.close();
    }
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action);
    this.tail = task.catch(() => undefined);
    return task;
  }

  read() {
    return this.serial(() => this.load());
  }

  private change(revision: string, action: (entries: PromptPreset[]) => void) {
    return this.serial(async () => {
      libraryCheck(
        typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision),
      );
      const previous = await this.load();
      libraryCheck(previous.revision === revision, 'LIBRARY_CONFLICT');
      const entries = structuredClone(previous.entries);
      action(entries);
      libraryCheck(entries.length <= LIBRARY_LIMITS.entries, 'LIBRARY_LIMIT');
      const body = Buffer.from(
        JSON.stringify({
          format: 'sdstudio-prompt-library',
          version: 1,
          entries,
        }),
      );
      libraryCheck(body.length <= LIBRARY_LIMITS.bytes, 'LIBRARY_LIMIT');
      const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
      let created = false;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        created = true;
        try {
          await file.writeFile(body);
          await file.sync();
        } finally {
          await file.close();
        }
        libraryCheck(
          (await this.load()).revision === revision,
          'LIBRARY_CONFLICT',
        );
        await fs.rename(temporary, this.file);
        created = false;
        if (process.platform !== 'win32') {
          const dir = await fs.open(this.directory, 'r');
          try {
            await dir.sync();
          } finally {
            await dir.close();
          }
        }
        return { revision: digest(body), entries };
      } finally {
        if (created) await fs.unlink(temporary).catch(() => undefined);
      }
    });
  }

  save(revision: string, content: PresetContent, id?: string) {
    const valid = validatePreset(content) as PresetContent;
    if (id !== undefined) libraryId(id);
    return this.change(revision, (entries) => {
      if (id) {
        const index = entries.findIndex((p) => p.id === id);
        libraryCheck(
          index >= 0 &&
            !entries[index].deleted &&
            entries[index].kind === valid.kind,
        );
        entries[index] = { ...valid, id, deleted: false };
      } else entries.push({ ...valid, id: randomUUID(), deleted: false });
    });
  }

  setDeleted(revision: string, id: string, deleted: boolean) {
    libraryId(id);
    libraryCheck(typeof deleted === 'boolean');
    return this.change(revision, (entries) => {
      const p = entries.find((entry) => entry.id === id);
      libraryCheck(p);
      p.deleted = deleted;
    });
  }

  remove(revision: string, id: string) {
    libraryId(id);
    return this.change(revision, (entries) => {
      const index = entries.findIndex((p) => p.id === id);
      libraryCheck(index >= 0 && entries[index].deleted);
      entries.splice(index, 1);
    });
  }
}

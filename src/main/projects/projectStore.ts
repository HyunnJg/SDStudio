/* eslint import/prefer-default-export: off, no-bitwise: off, no-restricted-syntax: off -- Ordered filesystem operations and POSIX open flags. */
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  PROJECT_FORMAT,
  PROJECT_LIMITS,
  ProjectError,
  projectCheck,
  projectId,
  projectHash,
  validateProjectContent,
  validateWorkspaceProject,
  validateImageInput,
} from '../../workspaceProject';
import type {
  ProjectContent,
  WorkspaceProject,
  ProjectSnapshot,
  ProjectImageInput,
  ProjectListing,
} from '../../workspaceProject';
import { validatePNGBytes } from '../nai/imageResponse';

const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function io<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw error instanceof ProjectError
      ? error
      : new ProjectError('PROJECT_IO');
  }
}
// Read one bounded regular file through the same fd. Never follow a final symlink/FIFO.
function read(file: string, limit: number): Uint8Array {
  const before = fs.lstatSync(file);
  projectCheck(before.isFile() && !before.isSymbolicLink(), 'PROJECT_CORRUPT');
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) |
      (fs.constants.O_NONBLOCK || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    projectCheck(
      stat.isFile() && stat.ino === before.ino && stat.dev === before.dev,
      'PROJECT_CORRUPT',
    );
    projectCheck(stat.size > 0, 'PROJECT_CORRUPT');
    projectCheck(stat.size <= limit, 'PROJECT_LIMIT');
    const bytes = new Uint8Array(stat.size);
    let position = 0;
    while (position < bytes.length) {
      const count = fs.readSync(
        fd,
        bytes,
        position,
        bytes.length - position,
        position,
      );
      projectCheck(count > 0, 'PROJECT_CORRUPT');
      position += count;
    }
    projectCheck(
      fs.readSync(fd, new Uint8Array(1), 0, 1, position) === 0,
      'PROJECT_CORRUPT',
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
// Directory fsync is unavailable through this API on Windows; that platform needs separate validation.
function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function writeNew(file: string, bytes: Uint8Array) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function decode(bytes: Uint8Array): WorkspaceProject {
  try {
    return validateWorkspaceProject(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch (error) {
    throw error instanceof ProjectError
      ? error
      : new ProjectError('PROJECT_CORRUPT');
  }
}
function encode(project: WorkspaceProject) {
  const bytes = Buffer.from(
    `${JSON.stringify(validateWorkspaceProject(project), null, 2)}\n`,
  );
  projectCheck(bytes.length <= PROJECT_LIMITS.jsonBytes, 'PROJECT_LIMIT');
  return Uint8Array.from(bytes);
}

// Private profile-local storage. No user-supplied filesystem path, V3 reader or credentials.
export class ProjectStore {
  constructor(private readonly profile: string) {
    projectCheck(path.isAbsolute(profile));
  }

  private directory(parts: string[], create = false): string {
    let current = this.profile;
    for (const part of ['', 'projects-v1', ...parts]) {
      if (part) current = path.join(current, part);
      try {
        const stat = fs.lstatSync(current);
        projectCheck(
          stat.isDirectory() && !stat.isSymbolicLink(),
          'PROJECT_CORRUPT',
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
        if (!create) throw new ProjectError('PROJECT_NOT_FOUND');
        // Non-recursive mkdir: validate each component instead of following an existing link.
        fs.mkdirSync(current, { mode: 0o700 });
        syncDirectory(path.dirname(current));
      }
    }
    return current;
  }

  private folder(id: string, create = false) {
    projectId(id);
    return this.directory([id], create);
  }

  private static immutable(file: string, bytes: Uint8Array) {
    try {
      writeNew(file, bytes);
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      projectCheck(
        Buffer.from(
          read(file, Math.max(PROJECT_LIMITS.jsonBytes, bytes.length)),
        ).equals(Uint8Array.from(bytes)),
        'PROJECT_CORRUPT',
      );
    }
  }

  private images(project: WorkspaceProject) {
    for (const image of project.images) {
      let bytes: Uint8Array;
      try {
        bytes = read(
          path.join(
            this.directory([project.id, 'images']),
            `${image.sha256}.png`,
          ),
          32 * 1024 * 1024,
        );
      } catch {
        throw new ProjectError('PROJECT_CORRUPT');
      }
      projectCheck(
        bytes.length === image.pngBytes && hash(bytes) === image.sha256,
        'PROJECT_CORRUPT',
      );
    }
  }

  private readSnapshot(
    id: string,
    file: string,
    verifyImages = true,
  ): ProjectSnapshot {
    const bytes = read(file, PROJECT_LIMITS.jsonBytes);
    const project = decode(bytes);
    projectCheck(project.id === id, 'PROJECT_CORRUPT');
    if (verifyImages) this.images(project);
    return { project, revision: hash(bytes) };
  }

  list(): ProjectListing[] {
    return io(() => {
      let root: string;
      try {
        root = this.directory([]);
      } catch (error) {
        if (error instanceof ProjectError && error.code === 'PROJECT_NOT_FOUND')
          return [];
        throw error;
      }
      const names = fs
        .readdirSync(root)
        .filter((name) => /^[a-f0-9-]{36}$/.test(name))
        .sort();
      projectCheck(names.length <= 1000, 'PROJECT_LIMIT');
      return names.map((id) => {
        try {
          const { project, revision } = this.readSnapshot(
            id,
            path.join(this.folder(id), 'project.json'),
            false,
          );
          return { id, name: project.name, revision };
        } catch (error) {
          return {
            id,
            error: error instanceof ProjectError ? error.code : 'PROJECT_IO',
          } as ProjectListing;
        }
      });
    });
  }

  open(id: string): ProjectSnapshot {
    return io(() =>
      this.readSnapshot(id, path.join(this.folder(id), 'project.json')),
    );
  }

  private createSnapshot(
    content: ProjectContent,
    images: WorkspaceProject['images'],
    sourceId?: string,
  ): ProjectSnapshot {
    const root = this.directory([], true);
    projectCheck(
      fs.readdirSync(root).filter((name) => /^[a-f0-9-]{36}$/.test(name))
        .length < 1000,
      'PROJECT_LIMIT',
    );
    const id = randomUUID();
    const project: WorkspaceProject = {
      format: PROJECT_FORMAT,
      version: 1,
      id,
      ...content,
      images,
    };
    const bytes = encode(project);
    const folder = this.folder(id, true);
    this.directory([id, 'images'], true);
    this.directory([id, 'history'], true);
    if (sourceId) {
      for (const image of images) {
        const original = this.readPNG(sourceId, image.sha256);
        projectCheck(original.length === image.pngBytes, 'PROJECT_CORRUPT');
        ProjectStore.immutable(
          path.join(folder, 'images', `${image.sha256}.png`),
          original,
        );
      }
    }
    writeNew(path.join(folder, 'project.json'), bytes);
    syncDirectory(path.join(folder, 'images'));
    syncDirectory(folder);
    return { project: structuredClone(project), revision: hash(bytes) };
  }

  create(content: unknown): ProjectSnapshot {
    return io(() => this.createSnapshot(validateProjectContent(content), []));
  }

  private update(
    id: string,
    revision: string,
    action: (project: WorkspaceProject, folder: string) => WorkspaceProject,
  ): ProjectSnapshot {
    return io(() => {
      projectHash(revision);
      const folder = this.folder(id);
      const lock = path.join(folder, 'write.lock');
      let fd: number;
      try {
        fd = fs.openSync(lock, 'wx', 0o600);
      } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST')
          throw new ProjectError('PROJECT_BUSY');
        throw error;
      }
      try {
        const current = this.open(id);
        projectCheck(current.revision === revision, 'PROJECT_CONFLICT');
        const previous = read(
          path.join(folder, 'project.json'),
          PROJECT_LIMITS.jsonBytes,
        );
        projectCheck(hash(previous) === revision, 'PROJECT_CONFLICT');
        const revisions = this.history(id);
        projectCheck(
          revisions.includes(revision) || revisions.length < 1000,
          'PROJECT_LIMIT',
        );
        const next = action(structuredClone(current.project), folder);
        const bytes = encode(next);
        const history = this.directory([id, 'history'], true);
        ProjectStore.immutable(
          path.join(history, `${revision}.json`),
          previous,
        );
        syncDirectory(history);
        const temporary = path.join(folder, `.next-${randomUUID()}.json`);
        try {
          writeNew(temporary, bytes);
          fs.renameSync(temporary, path.join(folder, 'project.json'));
          syncDirectory(folder);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return { project: next, revision: hash(bytes) };
      } finally {
        fs.closeSync(fd);
        fs.unlinkSync(lock);
      }
    });
  }

  save(id: string, revision: string, content: unknown): ProjectSnapshot {
    const validated = validateProjectContent(content);
    return this.update(id, revision, (current) => ({
      ...current,
      ...validated,
    }));
  }

  // Main-only: future generation code supplies verified PNG bytes and an explicit request snapshot.
  // No renderer PNG/path import IPC is exposed in this step.
  addPNG(
    id: string,
    revision: string,
    input: unknown,
    value: Uint8Array,
  ): ProjectSnapshot {
    const info: ProjectImageInput = validateImageInput(input);
    let png: Uint8Array;
    try {
      png = validatePNGBytes(value);
    } catch {
      throw new ProjectError('PROJECT_CORRUPT');
    }
    return this.update(id, revision, (current, folder) => {
      projectCheck(current.scenes.some((s) => s.id === info.sceneId));
      const sha256 = hash(png);
      const image = { ...info, id: randomUUID(), sha256, pngBytes: png.length };
      const next = { ...current, images: [...current.images, image] };
      encode(next); // Validate count/total/JSON bounds before any image write.
      this.directory([id, 'images'], true);
      ProjectStore.immutable(path.join(folder, 'images', `${sha256}.png`), png);
      syncDirectory(path.join(folder, 'images'));
      return next;
    });
  }

  readPNG(id: string, sha256: string): Uint8Array {
    return io(() => {
      projectHash(sha256);
      this.folder(id);
      const bytes = read(
        path.join(this.directory([id, 'images']), `${sha256}.png`),
        32 * 1024 * 1024,
      );
      projectCheck(hash(bytes) === sha256, 'PROJECT_CORRUPT');
      return Uint8Array.from(bytes);
    });
  }

  history(id: string): string[] {
    return io(() => {
      this.folder(id);
      let directory: string;
      try {
        directory = this.directory([id, 'history']);
      } catch (error) {
        if (error instanceof ProjectError && error.code === 'PROJECT_NOT_FOUND')
          return [];
        throw error;
      }
      const files = fs
        .readdirSync(directory)
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .sort();
      projectCheck(files.length <= 1000, 'PROJECT_LIMIT');
      return files.map((file) => file.slice(0, -5));
    });
  }

  recover(id: string, revision: string): ProjectSnapshot {
    return io(() => {
      projectHash(revision);
      this.folder(id);
      const file = path.join(
        this.directory([id, 'history']),
        `${revision}.json`,
      );
      const snapshot = this.readSnapshot(id, file);
      projectCheck(snapshot.revision === revision, 'PROJECT_CORRUPT');
      const { name, selectedSceneId, scenes, images } = snapshot.project;
      // Never overwrite a damaged/newer source. Recovery is an explicit new project copy.
      return this.createSnapshot({ name, selectedSceneId, scenes }, images, id);
    });
  }
}

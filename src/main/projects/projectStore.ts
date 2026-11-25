/* eslint import/prefer-default-export: off, no-bitwise: off, no-restricted-syntax: off -- Ordered filesystem operations and POSIX open flags. */
import fs from 'fs';
import sharp from 'sharp';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  REFERENCE_LIMITS,
  referenceSize,
  imageFormat,
  VARIATION_DEFAULTS,
} from '../../workspaceReference';
import { V5_SIZES } from '../../workspaceGenerationSettings';
import type { ImagePurpose, ReferenceAsset } from '../../workspaceReference';
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
  requiredProjectVersion,
  validateReference,
  validateVariation,
  projectReferences,
  remainingProjectBytes,
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
    if (verifyImages) {
      this.images(project);
      this.verifyReferences(project);
    }
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

  listTrash(): ProjectListing[] {
    return io(() => {
      let root: string;
      try {
        root = this.directory(['.trash']);
      } catch (error) {
        if (error instanceof ProjectError && error.code === 'PROJECT_NOT_FOUND')
          return [];
        throw error;
      }
      const ids = fs
        .readdirSync(root)
        .filter((name) => /^[a-f0-9-]{36}$/.test(name))
        .sort();
      projectCheck(ids.length <= 1000, 'PROJECT_LIMIT');
      return ids.map((id) => {
        try {
          projectId(id);
          const { project, revision } = this.readSnapshot(
            id,
            path.join(this.directory(['.trash', id]), 'project.json'),
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

  private static exists(file: string): boolean {
    try {
      fs.lstatSync(file);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      throw error;
    }
  }

  trashProject(id: string): void {
    io(() => {
      const folder = this.folder(id);
      const trash = this.directory(['.trash'], true);
      projectCheck(
        fs.readdirSync(trash).filter((name) => /^[a-f0-9-]{36}$/.test(name))
          .length < 1000,
        'PROJECT_LIMIT',
      );
      const destination = path.join(trash, id);
      projectCheck(!ProjectStore.exists(destination), 'PROJECT_CONFLICT');
      const lock = path.join(folder, 'write.lock');
      // Close the handle before moving the directory (Windows); the exclusive file still gates writers.
      try {
        writeNew(lock, Buffer.from('project-trash-v1\n'));
      } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST')
          throw new ProjectError('PROJECT_BUSY');
        throw error;
      }
      let moved = false;
      try {
        fs.renameSync(folder, destination);
        moved = true;
        syncDirectory(this.directory([]));
        syncDirectory(trash);
      } finally {
        fs.unlinkSync(path.join(moved ? destination : folder, 'write.lock'));
        syncDirectory(moved ? destination : folder);
      }
    });
  }

  restoreProject(id: string): void {
    io(() => {
      projectId(id);
      const source = this.directory(['.trash', id]);
      const root = this.directory([]);
      projectCheck(
        fs.readdirSync(root).filter((name) => /^[a-f0-9-]{36}$/.test(name))
          .length < 1000,
        'PROJECT_LIMIT',
      );
      const destination = path.join(root, id);
      projectCheck(!ProjectStore.exists(destination), 'PROJECT_CONFLICT');
      // Preserve any crash-left lock and every original byte. Opening will verify the data separately.
      fs.renameSync(source, destination);
      syncDirectory(root);
      syncDirectory(this.directory(['.trash']));
    });
  }

  setImageDeleted(
    id: string,
    revision: string,
    imageId: string,
    deleted: boolean,
  ): ProjectSnapshot {
    projectId(imageId);
    projectCheck(typeof deleted === 'boolean');
    return this.update(id, revision, (current) => {
      projectCheck(
        current.images.some((image) => image.id === imageId),
        'PROJECT_NOT_FOUND',
      );
      const ids = new Set(current.trashedImageIds ?? []);
      if (ids.has(imageId) === deleted) return current;
      if (deleted) ids.add(imageId);
      else {
        this.image(id, imageId);
        ids.delete(imageId);
      }
      return {
        ...current,
        version: Math.max(current.version, 6) as WorkspaceProject['version'],
        trashedImageIds: [...ids],
      };
    });
  }

  open(id: string): ProjectSnapshot {
    return io(() =>
      this.readSnapshot(id, path.join(this.folder(id), 'project.json')),
    );
  }

  // Internal metadata read: validate the manifest, but leave PNG verification to the requested operation.
  readManifest(id: string): ProjectSnapshot {
    return io(() =>
      this.readSnapshot(id, path.join(this.folder(id), 'project.json'), false),
    );
  }

  image(id: string, imageId: string): Uint8Array {
    return io(() => {
      projectId(imageId);
      const snapshot = this.readManifest(id);
      const image = snapshot.project.images.find((item) => item.id === imageId);
      projectCheck(image, 'PROJECT_NOT_FOUND');
      const bytes = this.readPNG(id, image.sha256);
      projectCheck(bytes.length === image.pngBytes, 'PROJECT_CORRUPT');
      return bytes;
    });
  }

  private createSnapshot(
    content: ProjectContent,
    images: WorkspaceProject['images'],
    sourceId?: string,
    trashedImageIds?: string[],
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
      version: Math.max(
        trashedImageIds !== undefined ? 6 : 1,
        requiredProjectVersion(content, images),
      ) as WorkspaceProject['version'],
      id,
      ...content,
      images,
      ...(trashedImageIds !== undefined
        ? { trashedImageIds: [...trashedImageIds] }
        : {}),
    };
    const bytes = encode(project);
    projectCheck(sourceId || projectReferences(project, images).length === 0);
    const folder = this.folder(id, true);
    this.directory([id, 'images'], true);
    this.directory([id, 'history'], true);
    if (sourceId) {
      this.copyReferences(sourceId, project);
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

  create(content: unknown, referenceSourceId?: string): ProjectSnapshot {
    if (referenceSourceId !== undefined) projectId(referenceSourceId);
    return io(() =>
      this.createSnapshot(
        validateProjectContent(content),
        [],
        referenceSourceId,
      ),
    );
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
        const current = this.readSnapshot(
          id,
          path.join(folder, 'project.json'),
          false,
        );
        projectCheck(current.revision === revision, 'PROJECT_CONFLICT');
        const previous = read(
          path.join(folder, 'project.json'),
          PROJECT_LIMITS.jsonBytes,
        );
        projectCheck(hash(previous) === revision, 'PROJECT_CONFLICT');
        const next = action(structuredClone(current.project), folder);
        const bytes = encode(next);
        if (hash(bytes) === revision) return current; // Unchanged explicit save adds no history.
        const revisions = this.history(id);
        projectCheck(
          revisions.includes(revision) || revisions.length < 1000,
          'PROJECT_HISTORY_LIMIT',
        );
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
    return this.update(id, revision, (current) => {
      const known = new Set(
        projectReferences(current, current.images).map((r) =>
          JSON.stringify(r),
        ),
      );
      for (const r of projectReferences(validated)) {
        if (!known.has(JSON.stringify(r))) this.referenceBytes(id, r);
      }
      return {
        ...current,
        ...validated,
        version: Math.max(
          current.version,
          requiredProjectVersion(validated, current.images),
        ) as WorkspaceProject['version'],
      };
    });
  }

  generationSnapshot(
    id: string,
    revision: string,
    value?: unknown,
  ): ProjectSnapshot {
    const snapshot = this.readManifest(id);
    projectCheck(snapshot.revision === revision, 'PROJECT_CONFLICT');
    projectCheck(
      !fs.existsSync(path.join(this.folder(id), 'write.lock')),
      'PROJECT_BUSY',
    );
    projectCheck(
      snapshot.project.images.length < PROJECT_LIMITS.results,
      'PROJECT_RESULT_LIMIT',
    );
    projectCheck(
      remainingProjectBytes(snapshot.project) >= 32 * 1024 * 1024,
      'PROJECT_GENERATION_SPACE',
    );
    projectCheck(this.history(id).length < 1000, 'PROJECT_HISTORY_LIMIT');
    if (value !== undefined) {
      const input = validateImageInput(value);
      const asset = input.draft.reference ?? input.draft.img2img;
      if (asset) this.referenceBytes(id, asset);
      encode({
        ...snapshot.project,
        version: Math.max(
          snapshot.project.version,
          requiredProjectVersion(snapshot.project, [
            ...snapshot.project.images,
            input,
          ]),
        ) as WorkspaceProject['version'],
        images: [
          ...snapshot.project.images,
          {
            ...input,
            id: randomUUID(),
            sha256: '0'.repeat(64),
            pngBytes: 32 * 1024 * 1024,
          },
        ],
      });
    }
    return snapshot;
  }

  // Main-only: future generation code supplies verified PNG bytes and an explicit request snapshot.
  // No renderer PNG/path import IPC is exposed in this step.
  addPNG(
    id: string,
    revision: string,
    input: unknown,
    value: Uint8Array,
    imageId: string = randomUUID(),
  ): ProjectSnapshot {
    projectId(imageId);
    const info: ProjectImageInput = validateImageInput(input);
    let png: Uint8Array;
    try {
      png = validatePNGBytes(value);
    } catch {
      throw new ProjectError('PROJECT_CORRUPT');
    }
    return this.update(id, revision, (current, folder) => {
      projectCheck(current.scenes.some((s) => s.id === info.sceneId));
      const asset = info.draft.reference ?? info.draft.img2img;
      if (asset) this.referenceBytes(id, asset);
      const sha256 = hash(png);
      const image = { ...info, id: imageId, sha256, pngBytes: png.length };
      const next = {
        ...current,
        version: Math.max(
          current.version,
          requiredProjectVersion(current, [...current.images, image]),
        ) as WorkspaceProject['version'],
        images: [...current.images, image],
      };
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

  private referenceFile(
    id: string,
    sha256: string,
    expectedBytes: number,
    extension = 'png',
  ): Uint8Array {
    projectHash(sha256);
    let bytes: Uint8Array;
    try {
      bytes = read(
        path.join(this.directory([id, 'references']), `${sha256}.${extension}`),
        REFERENCE_LIMITS.sourceBytes,
      );
    } catch {
      throw new ProjectError('PROJECT_CORRUPT');
    }
    projectCheck(
      hash(bytes) === sha256 && bytes.length === expectedBytes,
      'PROJECT_CORRUPT',
    );
    return bytes;
  }

  referenceBytes(id: string, value: unknown): Uint8Array {
    return io(() => {
      const r =
        value && typeof value === 'object' && 'noise' in value
          ? validateVariation(value)
          : validateReference(value);
      this.referenceFile(id, r.sourceHash, r.sourceBytes, r.sourceFormat);
      const bytes = this.referenceFile(id, r.uploadHash, r.uploadBytes);
      const b = Buffer.from(bytes);
      projectCheck(
        b.readUInt32BE(16) === r.width && b.readUInt32BE(20) === r.height,
        'PROJECT_CORRUPT',
      );
      return Uint8Array.from(bytes);
    });
  }

  private verifyReferences(project: WorkspaceProject) {
    const seen = new Set<string>();
    for (const r of projectReferences(project, project.images)) {
      const key = JSON.stringify(r);
      if (!seen.has(key)) {
        this.referenceBytes(project.id, r);
        seen.add(key);
      }
    }
  }

  private copyReferences(sourceId: string, project: WorkspaceProject) {
    const refs = projectReferences(project, project.images);
    if (!refs.length) return;
    const target = this.directory([project.id, 'references'], true);
    for (const r of new Map(
      refs.map((item) => [JSON.stringify(item), item]),
    ).values()) {
      this.referenceBytes(sourceId, r);
      for (const [sha, size, extension] of [
        [r.sourceHash, r.sourceBytes, r.sourceFormat ?? 'png'],
        [r.uploadHash, r.uploadBytes, 'png'],
      ] as const)
        ProjectStore.immutable(
          path.join(target, `${sha}.${extension}`),
          this.referenceFile(sourceId, sha, size, extension),
        );
    }
    syncDirectory(target);
  }

  referenceImage(id: string, sceneId: string): Uint8Array {
    const snapshot = this.readManifest(id);
    const draft = snapshot.project.scenes.find(
      (scene) => scene.id === sceneId,
    )?.draft;
    const reference = draft?.reference ?? draft?.img2img;
    projectCheck(reference, 'PROJECT_NOT_FOUND');
    return this.referenceBytes(id, reference);
  }

  async importReference(
    id: string,
    revision: string,
    value: Uint8Array,
    purpose: ImagePurpose = 'reference',
  ): Promise<ReferenceAsset> {
    projectId(id);
    projectHash(revision);
    projectCheck(
      value instanceof Uint8Array &&
        value.byteLength > 0 &&
        value.byteLength <= REFERENCE_LIMITS.sourceBytes,
    );
    projectCheck(purpose === 'reference' || purpose === 'img2img');
    const current = this.readManifest(id);
    projectCheck(current.revision === revision, 'PROJECT_CONFLICT');
    const scene = current.project.scenes.find(
      (s) => s.id === current.project.selectedSceneId,
    )!;
    if (purpose === 'img2img') projectCheck(scene.draft.family === 'v5');
    const source = Uint8Array.from(value);
    const format = imageFormat(source);
    projectCheck(format);
    let upload: Buffer;
    let size: { width: number; height: number };
    try {
      if (format === 'png') validatePNGBytes(source);
      const decoded = sharp(Buffer.from(source), {
        limitInputPixels: REFERENCE_LIMITS.sourcePixels,
        animated: false,
      });
      const meta = await decoded.metadata();
      projectCheck(
        meta.format === format &&
          !!meta.width &&
          !!meta.height &&
          (meta.pages === undefined || meta.pages === 1),
      );
      const rotated = (meta.orientation ?? 0) >= 5;
      size =
        purpose === 'img2img'
          ? V5_SIZES[scene.draft.resolution]
          : referenceSize(
              rotated ? meta.height! : meta.width!,
              rotated ? meta.width! : meta.height!,
            );
      // Upload is a separate centre-cropped derivative without PNG text chunks. Original bytes are retained unchanged.
      upload = await decoded
        .autoOrient()
        .resize({ ...size, fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
      validatePNGBytes(upload);
    } catch {
      throw new ProjectError('PROJECT_INPUT');
    }
    projectCheck(
      upload.length <= REFERENCE_LIMITS.uploadBytes,
      'PROJECT_IMAGE_TOO_LARGE',
    );
    projectCheck(
      this.readManifest(id).revision === revision,
      'PROJECT_CONFLICT',
    );
    projectCheck(
      !fs.existsSync(path.join(this.folder(id), 'write.lock')),
      'PROJECT_BUSY',
    );
    const asset: ReferenceAsset = {
      id: randomUUID(),
      ...(format !== 'png' ? { sourceFormat: format } : {}),
      sourceHash: hash(source),
      sourceBytes: source.length,
      uploadHash: hash(upload),
      uploadBytes: upload.length,
      ...size,
    };
    const provisional: WorkspaceProject = structuredClone(current.project);
    const { draft } = provisional.scenes.find((s) => s.id === scene.id)!;
    delete draft.reference;
    delete draft.img2img;
    if (purpose === 'img2img')
      draft.img2img = { ...asset, ...VARIATION_DEFAULTS };
    else
      draft.reference = {
        ...asset,
        role: 'character',
        strength: 1,
        preferSameOutfit: false,
      };
    projectCheck(remainingProjectBytes(provisional) >= 0, 'PROJECT_LIMIT');
    const folder = this.directory([id, 'references'], true);
    // Also bound orphan assets left by cancelled/unsaved imports. No automatic file deletion.
    const files = fs
      .readdirSync(folder)
      .filter((name) => /^[a-f0-9]{64}\.(?:png|webp|jpeg)$/.test(name));
    const missing = [
      [`${asset.sourceHash}.${format}`, source],
      [`${asset.uploadHash}.png`, upload],
    ].filter(([filename]) => !files.includes(filename as string));
    projectCheck(
      files.length + new Set(missing.map(([sha]) => sha)).size <= 360,
      'PROJECT_LIMIT',
    );
    const diskBytes = files.reduce((n, name) => {
      const st = fs.lstatSync(path.join(folder, name));
      projectCheck(st.isFile() && !st.isSymbolicLink(), 'PROJECT_CORRUPT');
      return n + st.size;
    }, 0);
    projectCheck(
      diskBytes +
        missing.reduce((n, [, bytes]) => n + (bytes as Uint8Array).length, 0) <=
        PROJECT_LIMITS.totalPNGBytes,
      'PROJECT_LIMIT',
    );
    ProjectStore.immutable(
      path.join(folder, `${asset.sourceHash}.${format}`),
      source,
    );
    ProjectStore.immutable(
      path.join(folder, `${asset.uploadHash}.png`),
      upload,
    );
    syncDirectory(folder);
    return asset;
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

  copy(id: string, revision: string, content: unknown): ProjectSnapshot {
    return io(() => {
      const validated = validateProjectContent(content);
      projectHash(revision);
      const current = this.open(id); // Copies verify every referenced PNG, unlike metadata-only save.
      projectCheck(current.revision === revision, 'PROJECT_CONFLICT');
      return this.createSnapshot(
        validated,
        current.project.images,
        id,
        current.project.trashedImageIds,
      );
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
      return this.createSnapshot(
        { name, selectedSceneId, scenes },
        images,
        id,
        snapshot.project.trashedImageIds,
      );
    });
  }
}

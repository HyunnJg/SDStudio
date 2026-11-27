import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  ProjectError,
  projectHash,
  projectId,
  validateImageInput,
  validateProjectContent,
} from '../../workspaceProject';
import type { ProjectContent, ProjectImageInput } from '../../workspaceProject';

export interface RequestRecord {
  content: ProjectContent;
  imageId: string;
  id: string;
  revision: string;
  input: ProjectImageInput;
}
export interface Pending extends RequestRecord {
  bytes: Uint8Array;
  queueItemId?: string;
}

const metadataLimit = 8 * 1024 * 1024;
const pngLimit = 32 * 1024 * 1024;
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

// One active request per profile. Replace the record only after the complete file is synced.
export class GenerationJournal {
  private readonly file: string;

  constructor(private readonly profile: string) {
    this.file = path.join(profile, 'workspace-generation-recovery.v1');
  }

  private syncDirectory() {
    if (process.platform === 'win32') return;
    const fd = fs.openSync(this.profile, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  write(record: RequestRecord, bytes?: Uint8Array) {
    const { content, imageId, id, revision, input } = record;
    const metadata = Buffer.from(
      JSON.stringify({
        content,
        imageId,
        id,
        revision,
        input,
        ...(bytes && { sha256: digest(bytes) }),
      }),
    );
    if (
      metadata.length > metadataLimit ||
      (bytes && (!bytes.length || bytes.length > pngLimit))
    )
      throw new ProjectError('PROJECT_LIMIT');
    const size = Buffer.alloc(4);
    size.writeUInt32BE(metadata.length);
    const temp = `${this.file}.tmp`;
    fs.rmSync(temp, { force: true });
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      try {
        fs.writeFileSync(fd, size);
        fs.writeFileSync(fd, metadata);
        if (bytes) fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.file);
      this.syncDirectory();
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  read() {
    const active = this.readFile(this.file);
    if (!active) return undefined;
    // A process may stop after flushing the response but before replacing the request marker.
    try {
      const staged = this.readFile(`${this.file}.tmp`);
      if (staged?.bytes && staged.record.imageId === active.record.imageId)
        return staged;
    } catch {
      /* A partial temporary write cannot supersede the committed record. */
    }
    return active;
  }

  private readFile(file: string) {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return undefined;
    if (
      !stat.isFile() ||
      stat.size < 4 ||
      stat.size > metadataLimit + pngLimit + 4
    )
      throw new ProjectError('PROJECT_CORRUPT');
    const data = fs.readFileSync(file);
    const end = 4 + data.readUInt32BE();
    if (end > data.length || end > metadataLimit + 4)
      throw new ProjectError('PROJECT_CORRUPT');
    const row = JSON.parse(data.toString('utf8', 4, end));
    projectId(row.id);
    projectId(row.imageId);
    projectHash(row.revision);
    const record: RequestRecord = {
      id: row.id,
      imageId: row.imageId,
      revision: row.revision,
      content: validateProjectContent(row.content),
      input: validateImageInput(row.input),
    };
    const bytes = data.subarray(end);
    if (!bytes.length && row.sha256 === undefined) return { record };
    if (
      !bytes.length ||
      bytes.length > pngLimit ||
      digest(bytes) !== row.sha256
    )
      throw new ProjectError('PROJECT_CORRUPT');
    return { record, bytes };
  }

  clear() {
    fs.rmSync(`${this.file}.tmp`, { force: true });
    fs.rmSync(this.file, { force: true });
    this.syncDirectory();
  }
}

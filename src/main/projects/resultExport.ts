import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  PROJECT_LIMITS,
  ProjectError,
  projectCheck,
  projectId,
} from '../../workspaceProject';
import type { ProjectReply } from '../../workspaceProject';
import type { ProjectService } from './projectService';

type Images = Pick<ProjectService, 'readManifest' | 'readPNG'>;
type Destination = (
  filename: string,
  extension: string,
) => Promise<string | undefined>;

export default function registerResultExport(
  ipc: Pick<IpcMain, 'handle'>,
  store: Images,
  profile: string,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  choose: Destination,
) {
  let exporting = false;
  ipc.handle(
    'workspace-project-export-results',
    async (event, id, ids): Promise<ProjectReply<boolean>> => {
      const guard = () => projectCheck(trusted(event), 'PROJECT_UNTRUSTED');
      try {
        guard();
        projectId(id);
        projectCheck(
          Array.isArray(ids) &&
            ids.length > 0 &&
            ids.length <= PROJECT_LIMITS.results,
        );
        ids.forEach(projectId);
        const selected = new Set(ids);
        projectCheck(selected.size === ids.length);
        projectCheck(!exporting, 'PROJECT_BUSY');
        exporting = true;
        try {
          const selection = async () => {
            const { project } = await store.readManifest(id);
            const hidden = new Set(project.trashedImageIds);
            const visible = project.images.filter(
              (i) => selected.has(i.id) && !hidden.has(i.id),
            );
            projectCheck(visible.length === ids.length, 'PROJECT_NOT_FOUND');
            return visible;
          };
          const preview = await selection();
          const single = preview.length === 1;
          const ext = single ? 'png' : 'zip';
          const filename = single
            ? `sdstudio-${preview[0].seed}-${preview[0].id.slice(0, 8)}.png`
            : `sdstudio-${id.slice(0, 8)}-${preview.length}.zip`;
          guard();
          const destination = await choose(filename, ext);
          guard();
          if (!destination) return { ok: true, value: false };
          projectCheck(path.extname(destination).toLowerCase() === `.${ext}`);
          const images = await selection();
          const directory = await fs.realpath(path.dirname(destination));
          const relative = path.relative(await fs.realpath(profile), directory);
          projectCheck(
            relative === '..' ||
              relative.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relative),
          );
          const temporary = await fs.mkdtemp(
            path.join(directory, '.sdstudio-export-'),
          );
          const staged = path.join(temporary, filename);
          try {
            const read = async (image: (typeof images)[number]) => {
              guard();
              const bytes = await store.readPNG(id, image.sha256);
              projectCheck(bytes.length === image.pngBytes, 'PROJECT_CORRUPT');
              return Buffer.from(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength,
              );
            };
            if (single) {
              await fs.writeFile(staged, await read(images[0]), {
                flag: 'wx',
                mode: 0o600,
              });
            } else {
              const archive = new JSZip();
              images.forEach((image, index) => {
                async function* original() {
                  yield await read(image);
                }
                const number = String(index + 1).padStart(3, '0');
                archive.file(
                  `${number}-${image.seed}-${image.id}.png`,
                  Readable.from(original()),
                );
              });
              await pipeline(
                archive.generateNodeStream({
                  streamFiles: true,
                  compression: 'STORE',
                }),
                createWriteStream(staged, { flags: 'wx', mode: 0o600 }),
              );
            }
            guard();
            await fs.rename(
              staged,
              path.join(directory, path.basename(destination)),
            );
            return { ok: true, value: true };
          } finally {
            await fs.rm(temporary, { recursive: true, force: true });
          }
        } finally {
          exporting = false;
        }
      } catch (error) {
        return {
          ok: false,
          code: error instanceof ProjectError ? error.code : 'PROJECT_IO',
        };
      }
    },
  );
}

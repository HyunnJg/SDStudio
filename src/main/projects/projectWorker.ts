import { parentPort, workerData } from 'worker_threads';
import { ProjectStore } from './projectStore';
import { ProjectError } from '../../workspaceProject';

const store = new ProjectStore(workerData.profile);
const operations = [
  'importReference',
  'referenceBytes',
  'referenceImage',
  'list',
  'listTrash',
  'trashProject',
  'restoreProject',
  'setImageDeleted',
  'create',
  'open',
  'save',
  'history',
  'recover',
  'copy',
  'generationSnapshot',
  'readManifest',
  'image',
  'addPNG',
  'readPNG',
] as const;
let tail = Promise.resolve();
parentPort!.on('message', ({ id, operation, args }) => {
  tail = tail.then(async () => {
    try {
      if (!operations.includes(operation) || !Array.isArray(args))
        throw new ProjectError('PROJECT_INPUT');
      const value = await (
        store[operation as (typeof operations)[number]] as (
          ...a: unknown[]
        ) => unknown
      ).apply(store, args);
      parentPort!.postMessage({ id, ok: true, value });
    } catch (error) {
      parentPort!.postMessage({
        id,
        ok: false,
        code: error instanceof ProjectError ? error.code : 'PROJECT_IO',
      });
    }
    return undefined;
  });
});

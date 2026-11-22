import { parentPort, workerData } from 'worker_threads';
import { ProjectStore } from './projectStore';
import { ProjectError } from '../../workspaceProject';

const store = new ProjectStore(workerData.profile);
const operations = [
  'list',
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
parentPort!.on('message', ({ id, operation, args }) => {
  try {
    if (!operations.includes(operation) || !Array.isArray(args))
      throw new ProjectError('PROJECT_INPUT');
    const value = (
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
});

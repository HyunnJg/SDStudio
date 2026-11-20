import { backend } from '.';
import { getPlatform } from './util';

async function getLocalAIDownloadLink() {
  const platform = await getPlatform();
  const version = await backend.getVersion();
  return `https://huggingface.co/mathneko/localai/resolve/main/LocalAI-${platform}.zip?download=true`;
}
const QUALITY_DOWNLOAD_LINK =
  'https://github.com/sunho/BiRefNet/releases/download/sdstudio/quality';

export class LocalAIService extends EventTarget {
  downloading: boolean;
  modelLoaded: boolean;
  ready: boolean;
  constructor(private enabled = true) {
    super();
    this.downloading = false;
    this.modelLoaded = false;
    this.ready = false;
  }

  notifyDownloadProgress(percent: number) {
    this.dispatchEvent(new CustomEvent('progress', { detail: { percent } }));
  }

  modelChanged() {
    this.modelLoaded = false;
  }

  assertEnabled() {
    if (!this.enabled) throw new Error('Local AI is disabled in offline preview');
  }

  async download() {
    this.assertEnabled();
    this.downloading = true;
    try {
      await backend.deleteFile('tmp/localai.zip');
    } catch (e) {}
    try {
      await backend.deleteDir('localai');
    } catch (e) {}
    try {
      await backend.deleteDir('models');
    } catch (e) {}
    try {
      let ldl = await getLocalAIDownloadLink();
      this.dispatchEvent(new CustomEvent('stage', { detail: { stage: 0 } }));
      await backend.download(ldl, 'tmp', 'localai.zip');
      this.dispatchEvent(new CustomEvent('stage', { detail: { stage: 1 } }));
      await backend.download(QUALITY_DOWNLOAD_LINK, 'models', 'quality');
      this.dispatchEvent(new CustomEvent('stage', { detail: { stage: 2 } }));
      await backend.extractZip('tmp/localai.zip', '');
      await this.statsModels();
    } catch (e: any) {
      console.error(e);
    } finally {
      this.downloading = false;
    }
  }

  async spawnLocalAI() {
    this.assertEnabled();
    const running = await backend.isLocalAIRunning();
    if (running) {
      return;
    }
    await backend.spawnLocalAI();
  }

  async statsModels() {
    if (!this.enabled) return;
    const avail: any = {
      fast: false,
      quality: false,
    };
    let availExec = false;
    try {
      availExec = await backend.existFile('localai');
    } catch (e: any) {
      console.error(e);
    }
    for (const model of ['fast', 'quality']) {
      try {
        avail[model] = await backend.existFile('models/' + model);
      } catch (e: any) {
        console.error(e);
      }
    }
    if (availExec && avail.quality) {
      this.ready = true;
      this.spawnLocalAI();
    } else {
      this.ready = false;
    }
    this.dispatchEvent(new CustomEvent('updated', {}));
  }

  async loadModel() {
    this.assertEnabled();
    const running = await backend.isLocalAIRunning();
    if (!this.ready || !running) throw new Error('Local AI not ready');
    const modelType = 'quality';
    this.modelLoaded = false;
    await backend.loadModel('models/' + modelType);
    this.modelLoaded = true;
  }

  async removeBg(image: string, outputFilePath: string) {
    this.assertEnabled();
    if (!this.modelLoaded) await this.loadModel();
    await backend.removeBackground(image, outputFilePath);
  }
}

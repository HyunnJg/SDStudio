/* Preview implements the complete Backend contract, including intentional no-ops. */
/* eslint class-methods-use-this: off, no-empty-function: off, import/prefer-default-export: off */
import { Backend, ResizeImageInput } from '../backend';
import type { Config } from '../../main/config';
import type { ImageGenInput } from './imageGen';
import type {
  PreviewRequest,
  PreviewScenario,
} from '../preview/workspaceDraft';
import previewArtwork from '../preview/previewArtwork';

const FIXTURE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAAL0lEQVR4nO3NQQkAAAgEsEtnK9NZzBQ+hMH+S/WcikAgEAgEAoFAIBAIBAKB4FOwYx8kiE+dRPgAAAAASUVORK5CYII=';

export class MockBackend extends Backend {
  readonly files = new Map<string, string>();

  readonly generations: ImageGenInput[] = [];

  readonly previewRequests: PreviewRequest[] = [];

  async renderDraftPreview(request: PreviewRequest, scenario: PreviewScenario) {
    if (scenario !== 'success') {
      throw Object.assign(new Error('Synthetic preview error'), {
        code: scenario === 'prompt-length' ? 'PROMPT_TOO_LONG' : 'CONNECTION',
      });
    }
    this.previewRequests.push(structuredClone(request));
    return previewArtwork(request.parameters.width, request.parameters.height);
  }

  private config: Config = {};

  async getConfig() {
    return { ...this.config };
  }

  async setConfig(value: Config) {
    this.config = { ...value };
  }

  async getVersion() {
    return '3.1.11-preview';
  }

  async generateImage(input: ImageGenInput) {
    this.generations.push(structuredClone(input));
    this.files.set(input.outputFilePath, FIXTURE_PNG);
  }

  async augmentImage(): Promise<never> {
    throw new Error('Image augmentation is unavailable in offline preview');
  }

  async login(): Promise<never> {
    throw new Error('Account login is disabled in offline preview');
  }

  async getRemainCredits(): Promise<never> {
    throw new Error('Account credits are unavailable in offline preview');
  }

  async openWebPage(): Promise<never> {
    throw new Error('External pages are disabled in offline preview');
  }

  async download(): Promise<never> {
    throw new Error('Downloads are disabled in offline preview');
  }

  async spawnLocalAI(): Promise<never> {
    throw new Error('Local AI is disabled in offline preview');
  }

  async loadModel(): Promise<never> {
    throw new Error('Local AI is disabled in offline preview');
  }

  async removeBackground(): Promise<never> {
    throw new Error('Local AI is disabled in offline preview');
  }

  async isLocalAIRunning() {
    return false;
  }

  async readFile(name: string) {
    const value = this.files.get(name);
    if (value === undefined) throw new Error(`Preview file not found: ${name}`);
    return value;
  }

  async writeFile(name: string, value: string) {
    this.files.set(name, value);
  }

  async writeDataFile(name: string, value: string) {
    this.files.set(name, value.replace(/^data:[^,]+,/, ''));
  }

  async readDataFile(name: string) {
    return `data:image/png;base64,${await this.readFile(name)}`;
  }

  async listFiles(directory: string) {
    const prefix = `${directory.replace(/\/$/, '')}/`;
    return [
      ...new Set(
        [...this.files.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length).split('/')[0]),
      ),
    ].sort();
  }

  async existFile(name: string) {
    return (
      this.files.has(name) ||
      [...this.files.keys()].some((file) => file.startsWith(`${name}/`))
    );
  }

  async copyFile(source: string, destination: string) {
    this.files.set(destination, await this.readFile(source));
  }

  async renameFile(source: string, destination: string) {
    await this.copyFile(source, destination);
    this.files.delete(source);
  }

  async renameDir(source: string, destination: string) {
    [...this.files.keys()]
      .filter((name) => name.startsWith(`${source}/`))
      .forEach((name) => {
        this.files.set(
          destination + name.slice(source.length),
          this.files.get(name)!,
        );
        this.files.delete(name);
      });
  }

  async deleteFile(name: string) {
    this.files.delete(name);
  }

  async deleteDir(directory: string) {
    [...this.files.keys()]
      .filter((name) => name.startsWith(`${directory}/`))
      .forEach((name) => this.files.delete(name));
  }

  async trashFile(name: string) {
    this.files.delete(name);
  }

  async searchTags() {
    return [];
  }

  async lookupTag() {
    return undefined;
  }

  async searchPieces() {
    return [];
  }

  async loadPiecesDB() {}

  async selectDir() {
    return undefined;
  }

  async selectFile() {
    return undefined;
  }

  async close() {}

  async showFile(): Promise<never> {
    throw new Error('System file browsing is unavailable in offline preview');
  }

  async copyToDownloads(): Promise<never> {
    throw new Error('Export is unavailable in offline preview');
  }

  async copyImageToClipboard(): Promise<never> {
    throw new Error('Clipboard export is unavailable in offline preview');
  }

  async openImageEditor(): Promise<never> {
    throw new Error('External editing is unavailable in offline preview');
  }

  async watchImage() {}

  async unwatchImage() {}

  async zipFiles(): Promise<never> {
    throw new Error('Archives are unavailable in offline preview');
  }

  async unzipFiles(): Promise<never> {
    throw new Error('Archives are unavailable in offline preview');
  }

  async extractZip(): Promise<never> {
    throw new Error('Archives are unavailable in offline preview');
  }

  async resizeImage(input: ResizeImageInput) {
    // Preview thumbnails retain fixture bytes; production image processing is not simulated.
    await this.copyFile(input.inputPath, input.outputPath);
  }

  onDownloadProgress() {
    return () => {};
  }

  onZipProgress() {
    return () => {};
  }

  onImageChanged() {
    return () => {};
  }

  onClose() {
    return () => {};
  }
}

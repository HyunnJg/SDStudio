/* eslint import/prefer-default-export: off */
import { clipboard, ClipboardItem, nativeImage } from 'electron';

export async function copyImageToClipboard(file: string): Promise<void> {
  const image = nativeImage.createFromPath(file);
  await clipboard.write([
    new ClipboardItem({
      'image/png': new Blob([Uint8Array.from(image.toPNG())], {
        type: 'image/png',
      }),
    }),
  ]);
}

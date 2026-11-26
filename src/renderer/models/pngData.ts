export function base64ToDataUri(data: string) {
  return `data:image/png;base64,${data}`;
}

export function getImageDimensions(
  base64: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width } = img;
      const { height } = img;
      resolve({ width, height });
    };
    img.onerror = reject;
    img.src = base64ToDataUri(base64);
  });
}

export function pngBlob(base64: string) {
  return new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
    type: 'image/png',
  });
}

export function readPNGBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

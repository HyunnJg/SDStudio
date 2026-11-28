export default async function readVibeJSON(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) {
      // eslint-disable-next-line no-await-in-loop
      await reader.cancel();
      throw Error();
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

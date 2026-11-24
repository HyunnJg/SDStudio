/* eslint no-bitwise: off -- PNG/ZIP CRC32 uses unsigned bit operations. */
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
export default function crc32(bytes: ArrayLike<number>, previous = 0): number {
  let crc = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1)
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

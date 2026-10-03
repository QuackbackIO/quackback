/** Minimal image headers: enough bytes for magic-byte sniffing and dimension parsing. */
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

export function pngOf(width: number, height: number): Buffer {
  return Buffer.from([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...u32be(13),
    ...Buffer.from('IHDR', 'ascii'),
    ...u32be(width),
    ...u32be(height),
    ...[8, 6, 0, 0, 0, 0, 0, 0, 0],
  ])
}

/** An ICO directory whose entries are square icons of the given sizes (0 means 256). */
export function icoOf(...sizes: number[]): Buffer {
  return Buffer.from([
    ...[0, 0, 1, 0],
    ...u16le(sizes.length),
    ...sizes.flatMap((size) => [size, size, ...new Array<number>(14).fill(0)]),
  ])
}

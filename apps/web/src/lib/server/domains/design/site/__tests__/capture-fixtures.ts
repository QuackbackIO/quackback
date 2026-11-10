/** A minimal PNG: its magic, then an IHDR chunk header with the width and height. */
export function fakePng(width: number, height: number, extra = 16): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24 + extra)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/**
 * Minimal PNG decode and encode in plain TypeScript (zlib from node:zlib).
 * Decodes 8-bit greyscale, grey and alpha, RGB, RGBA and palette images,
 * non-interlaced and Adam7; 16-bit samples are reduced to 8. Output is always
 * RGBA, 4 bytes per pixel.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deflateSync, inflateSync } from 'node:zlib'

export interface Image {
  width: number
  height: number
  /** RGBA, row by row. */
  data: Uint8Array
}

/** Largest image decoded, in pixels (a 2880 by 8000 capture is 23 million). */
export const MAX_PIXELS = 25_000_000

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function isPng(buf: Uint8Array): boolean {
  return buf.length > 8 && SIG.every((b, i) => buf[i] === b)
}

export function decodePng(buf: Uint8Array): Image {
  if (!isPng(buf)) throw new Error('not a PNG')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (pos + 8 <= buf.length) {
    const len = dv.getUint32(pos)
    const type = String.fromCharCode(buf[pos + 4]!, buf[pos + 5]!, buf[pos + 6]!, buf[pos + 7]!)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8)
      height = dv.getUint32(pos + 12)
      depth = body[8]!
      colorType = body[9]!
      interlace = body[12]!
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') trns = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = CHANNELS[colorType]
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`)
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('PNG too large')
  if (colorType === 3 && !palette) throw new Error('PNG palette missing')
  // Filter bytes plus the widest possible rows (Adam7 adds at most a few per pass).
  const maxRaw = height * (1 + Math.ceil((width * channels * depth) / 8)) * 2 + 64
  const raw = inflateSync(concat(idat), { maxOutputLength: maxRaw })
  const bpp = Math.max(1, (channels * depth) / 8)
  const out = new Uint8Array(width * height * 4)
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]]
  let off = 0
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx)
    const ph = Math.ceil((height - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    const stride = Math.ceil((pw * channels * depth) / 8)
    let prev = new Uint8Array(stride)
    for (let y = 0; y < ph; y++) {
      if (off + 1 + stride > raw.length) throw new Error('PNG data truncated')
      const ft = raw[off]!
      const line = raw.slice(off + 1, off + 1 + stride)
      off += 1 + stride
      unfilter(ft, line, prev, bpp)
      for (let x = 0; x < pw; x++) {
        const o = ((y0 + y * dy) * width + (x0 + x * dx)) * 4
        writePixel(line, x, depth, colorType, palette, trns, out, o)
      }
      prev = line
    }
  }
  return { width, height, data: out }
}

function unfilter(ft: number, line: Uint8Array, prev: Uint8Array, bpp: number) {
  if (ft === 0) return
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp]! : 0
    const b = prev[i]!
    const c = i >= bpp ? prev[i - bpp]! : 0
    let v = line[i]!
    if (ft === 1) v += a
    else if (ft === 2) v += b
    else if (ft === 3) v += (a + b) >> 1
    else if (ft === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    line[i] = v & 255
  }
}

function sample(line: Uint8Array, idx: number, depth: number): number {
  if (depth === 8) return line[idx]!
  if (depth === 16) return line[idx * 2]!
  const perByte = 8 / depth
  const byte = line[Math.floor(idx / perByte)]!
  const shift = 8 - depth * ((idx % perByte) + 1)
  return (byte >> shift) & ((1 << depth) - 1)
}

function writePixel(
  line: Uint8Array,
  x: number,
  depth: number,
  ct: number,
  pal: Uint8Array | null,
  trns: Uint8Array | null,
  out: Uint8Array,
  o: number
) {
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
  if (ct === 3) {
    const i = sample(line, x, depth)
    out[o] = pal![i * 3] ?? 0
    out[o + 1] = pal![i * 3 + 1] ?? 0
    out[o + 2] = pal![i * 3 + 2] ?? 0
    out[o + 3] = trns && i < trns.length ? trns[i]! : 255
  } else if (ct === 0) {
    const g = Math.round(sample(line, x, depth) * scale)
    out[o] = out[o + 1] = out[o + 2] = g
    out[o + 3] = 255
  } else if (ct === 4) {
    out[o] = out[o + 1] = out[o + 2] = sample(line, x * 2, depth)
    out[o + 3] = sample(line, x * 2 + 1, depth)
  } else if (ct === 2) {
    out[o] = sample(line, x * 3, depth)
    out[o + 1] = sample(line, x * 3 + 1, depth)
    out[o + 2] = sample(line, x * 3 + 2, depth)
    out[o + 3] = 255
  } else {
    out[o] = sample(line, x * 4, depth)
    out[o + 1] = sample(line, x * 4 + 1, depth)
    out[o + 2] = sample(line, x * 4 + 2, depth)
    out[o + 3] = sample(line, x * 4 + 3, depth)
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * An RGBA PNG, filter "Up" on every row (good enough for screenshots). The
 * bytes are stable for the same pixels, so a model call can be cached by them.
 */
export function encodePng(img: Image): Uint8Array {
  const { width, height, data } = img
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2
    for (let i = 0; i < stride; i++) {
      const cur = data[y * stride + i]!
      const up = y ? data[(y - 1) * stride + i]! : 0
      raw[y * (stride + 1) + 1 + i] = (cur - up) & 255
    }
  }
  const chunk = (type: string, body: Uint8Array) => {
    const o = new Uint8Array(12 + body.length)
    const dv = new DataView(o.buffer)
    dv.setUint32(0, body.length)
    for (let i = 0; i < 4; i++) o[4 + i] = type.charCodeAt(i)
    o.set(body, 8)
    dv.setUint32(8 + body.length, crc32(o.subarray(4, 8 + body.length)))
    return o
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  return concat([
    new Uint8Array(SIG),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/** Area-average downscale by a whole factor (a retina capture at 2x to 1x). */
export function downscale(img: Image, f: number): Image {
  if (f <= 1) return img
  const w = Math.floor(img.width / f)
  const h = Math.floor(img.height / f)
  const out = new Uint8Array(w * h * 4)
  const acc = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      acc.fill(0)
      for (let j = 0; j < f; j++) {
        for (let i = 0; i < f; i++) {
          const o = ((y * f + j) * img.width + (x * f + i)) * 4
          for (let c = 0; c < 4; c++) acc[c]! += img.data[o + c]!
        }
      }
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c]! / (f * f))
    }
  }
  return { width: w, height: h, data: out }
}

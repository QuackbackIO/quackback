/**
 * Colour helpers: sRGB to OKLab and CIELAB (D65), deltaE 2000, hex and CSS
 * colour parsing. No dependencies.
 */
export type RGB = [number, number, number]

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function oklab([r, g, b]: RGB): RGB {
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** CIELAB under D65. */
export function lab([r, g, b]: RGB): RGB {
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** CIEDE2000 between two CIELAB colours (Sharma, Wu and Dalal 2005). */
export function deltaE00Lab([L1, a1, b1]: RGB, [L2, a2, b2]: RGB): number {
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const ap1 = a1 * (1 + G)
  const ap2 = a2 * (1 + G)
  const Cp1 = Math.hypot(ap1, b1)
  const Cp2 = Math.hypot(ap2, b2)
  const hue = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0
    const h = (Math.atan2(b, a) * 180) / Math.PI
    return h < 0 ? h + 360 : h
  }
  const hp1 = hue(ap1, b1)
  const hp2 = hue(ap2, b2)
  const dL = L2 - L1
  const dC = Cp2 - Cp1
  let dh = hp2 - hp1
  if (Cp1 * Cp2 === 0) dh = 0
  else if (dh > 180) dh -= 360
  else if (dh < -180) dh += 360
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dh) / 2)
  const Lb = (L1 + L2) / 2
  const Cpb = (Cp1 + Cp2) / 2
  let hb = hp1 + hp2
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hb /= 2
    else hb = hb < 360 ? (hb + 360) / 2 : (hb - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hb - 30)) +
    0.24 * Math.cos(rad(2 * hb)) +
    0.32 * Math.cos(rad(3 * hb + 6)) -
    0.2 * Math.cos(rad(4 * hb - 63))
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2)
  const Sc = 1 + 0.045 * Cpb
  const Sh = 1 + 0.015 * Cpb * T
  const Rt = -Math.sin(rad(2 * dTh)) * Rc
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))
}

/** CIEDE2000 between two sRGB colours (under 2 reads as the same; under 5 close). */
export function deltaE00(c1: RGB, c2: RGB): number {
  return deltaE00Lab(lab(c1), lab(c2))
}

/** Distance in OKLab (0 is the same colour; about 0.02 is just noticeable). */
export function okDist(a: RGB, b: RGB): number {
  const x = oklab(a)
  const y = oklab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

export function hex([r, g, b]: RGB): string {
  const part = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** "#rrggbb", "#rgb" or "rgb(a)(r, g, b...)" to RGB, or null. */
export function parseColor(c: string | null | undefined): RGB | null {
  if (!c) return null
  const s = c.trim()
  const long = /^#([0-9a-f]{6})$/i.exec(s)
  if (long) {
    const h = long[1]!
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const short = /^#([0-9a-f]{3})$/i.exec(s)
  if (short) {
    const h = short[1]!
    return [parseInt(h[0]! + h[0], 16), parseInt(h[1]! + h[1], 16), parseInt(h[2]! + h[2], 16)]
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

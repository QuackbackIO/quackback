/**
 * CFF glyph outlines (Type 2 charstrings, as Geist ships), flattened to
 * polylines in font units.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Path, Pt } from './sfnt'

// ---------- CFF ----------
function cffIndex(t: DataView, o: number): { items: Array<[number, number]>; end: number } {
  const count = t.getUint16(o)
  if (!count) return { items: [], end: o + 2 }
  const os = t.getUint8(o + 2)
  const rd = (p: number) => {
    let v = 0
    for (let i = 0; i < os; i++) v = v * 256 + t.getUint8(p + i)
    return v
  }
  const base = o + 3 + (count + 1) * os - 1
  const items: Array<[number, number]> = []
  for (let i = 0; i < count; i++)
    items.push([base + rd(o + 3 + i * os), base + rd(o + 3 + (i + 1) * os)])
  return { items, end: base + rd(o + 3 + count * os) }
}

function cffDict(t: DataView, a: number, b: number): Map<number, number[]> {
  const d = new Map<number, number[]>()
  let ops: number[] = []
  let p = a
  while (p < b) {
    const v = t.getUint8(p)
    if (v <= 21) {
      let k = v
      p++
      if (v === 12) {
        k = 1200 + t.getUint8(p)
        p++
      }
      d.set(k, ops)
      ops = []
    } else if (v === 28) {
      ops.push(t.getInt16(p + 1))
      p += 3
    } else if (v === 29) {
      ops.push(t.getInt32(p + 1))
      p += 5
    } else if (v === 30) {
      p++
      for (;;) {
        const n = t.getUint8(p++)
        if ((n & 15) === 15 || n >> 4 === 15) break
      }
      ops.push(0)
    } else if (v >= 32 && v <= 246) {
      ops.push(v - 139)
      p++
    } else if (v >= 247 && v <= 250) {
      ops.push((v - 247) * 256 + t.getUint8(p + 1) + 108)
      p += 2
    } else if (v >= 251 && v <= 254) {
      ops.push(-(v - 251) * 256 - t.getUint8(p + 1) - 108)
      p += 2
    } else p++
  }
  return d
}

export function cffFont(t: DataView): (g: number) => Path {
  const hdr = t.getUint8(2)
  const names = cffIndex(t, hdr)
  const top = cffIndex(t, names.end)
  const strings = cffIndex(t, top.end)
  const gsubrs = cffIndex(t, strings.end).items
  const td = cffDict(t, top.items[0]![0], top.items[0]![1])
  const cs = cffIndex(t, td.get(17)![0]!).items
  const [psize, poff] = td.get(18) ?? [0, 0]
  const pd = cffDict(t, poff!, poff! + psize!)
  const lsubrs = pd.get(19) ? cffIndex(t, poff! + pd.get(19)![0]!).items : []
  const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768)
  return (g: number) => {
    const path: Path = []
    let cur: Pt[] = []
    let x = 0,
      y = 0,
      nStems = 0,
      haveWidth = false
    const stack: number[] = []
    const close = () => {
      if (cur.length > 1) path.push(cur)
      cur = []
    }
    const moveTo = (nx: number, ny: number) => {
      close()
      x = nx
      y = ny
      cur = [[x, y]]
    }
    const lineTo = (nx: number, ny: number) => {
      x = nx
      y = ny
      cur.push([x, y])
    }
    const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      const steps = Math.max(2, Math.min(16, Math.ceil(Math.hypot(x3 - x, y3 - y) / 40)))
      const x0 = x,
        y0 = y
      for (let i = 1; i <= steps; i++) {
        const s = i / steps,
          u = 1 - s
        cur.push([
          u * u * u * x0 + 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s * x3,
          u * u * u * y0 + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * y3,
        ])
      }
      x = x3
      y = y3
    }
    const stems = () => {
      if (stack.length % 2 && !haveWidth) stack.shift()
      haveWidth = true
      nStems += stack.length >> 1
      stack.length = 0
    }
    const run = (a: number, b: number, depth: number): boolean => {
      let p = a
      while (p < b) {
        const v = t.getUint8(p++)
        if (v >= 32 || v === 28) {
          if (v === 28) {
            stack.push(t.getInt16(p))
            p += 2
          } else if (v <= 246) stack.push(v - 139)
          else if (v <= 250) stack.push((v - 247) * 256 + t.getUint8(p++) + 108)
          else if (v <= 254) stack.push(-(v - 251) * 256 - t.getUint8(p++) - 108)
          else {
            stack.push(t.getInt32(p) / 65536)
            p += 4
          }
          continue
        }
        switch (v) {
          case 1:
          case 3:
          case 18:
          case 23:
            stems()
            break
          case 19:
          case 20:
            stems()
            p += (nStems + 7) >> 3
            break
          case 21:
            if (stack.length > 2 && !haveWidth) stack.shift()
            haveWidth = true
            moveTo(x + stack[0]!, y + stack[1]!)
            stack.length = 0
            break
          case 22:
            if (stack.length > 1 && !haveWidth) stack.shift()
            haveWidth = true
            moveTo(x + stack[0]!, y)
            stack.length = 0
            break
          case 4:
            if (stack.length > 1 && !haveWidth) stack.shift()
            haveWidth = true
            moveTo(x, y + stack[0]!)
            stack.length = 0
            break
          case 5:
            for (let i = 0; i + 1 < stack.length; i += 2) lineTo(x + stack[i]!, y + stack[i + 1]!)
            stack.length = 0
            break
          case 6:
          case 7: {
            let h = v === 6
            for (const d of stack) {
              if (h) lineTo(x + d, y)
              else lineTo(x, y + d)
              h = !h
            }
            stack.length = 0
            break
          }
          case 8:
            for (let i = 0; i + 5 < stack.length; i += 6) {
              const s = stack
              curveTo(
                x + s[i]!,
                y + s[i + 1]!,
                x + s[i]! + s[i + 2]!,
                y + s[i + 1]! + s[i + 3]!,
                x + s[i]! + s[i + 2]! + s[i + 4]!,
                y + s[i + 1]! + s[i + 3]! + s[i + 5]!
              )
            }
            stack.length = 0
            break
          case 24: {
            const s = stack
            let i = 0
            for (; i + 7 < s.length; i += 6)
              curveTo(
                x + s[i]!,
                y + s[i + 1]!,
                x + s[i]! + s[i + 2]!,
                y + s[i + 1]! + s[i + 3]!,
                x + s[i]! + s[i + 2]! + s[i + 4]!,
                y + s[i + 1]! + s[i + 3]! + s[i + 5]!
              )
            lineTo(x + s[i]!, y + s[i + 1]!)
            stack.length = 0
            break
          }
          case 25: {
            const s = stack
            let i = 0
            for (; i + 7 < s.length; i += 2) lineTo(x + s[i]!, y + s[i + 1]!)
            curveTo(
              x + s[i]!,
              y + s[i + 1]!,
              x + s[i]! + s[i + 2]!,
              y + s[i + 1]! + s[i + 3]!,
              x + s[i]! + s[i + 2]! + s[i + 4]!,
              y + s[i + 1]! + s[i + 3]! + s[i + 5]!
            )
            stack.length = 0
            break
          }
          case 26: {
            const s = stack
            let i = 0,
              dx1 = 0
            if (s.length % 2) {
              dx1 = s[0]!
              i = 1
            }
            for (; i + 3 < s.length; i += 4) {
              curveTo(
                x + dx1,
                y + s[i]!,
                x + dx1 + s[i + 1]!,
                y + s[i]! + s[i + 2]!,
                x + dx1 + s[i + 1]!,
                y + s[i]! + s[i + 2]! + s[i + 3]!
              )
              dx1 = 0
            }
            stack.length = 0
            break
          }
          case 27: {
            const s = stack
            let i = 0,
              dy1 = 0
            if (s.length % 2) {
              dy1 = s[0]!
              i = 1
            }
            for (; i + 3 < s.length; i += 4) {
              curveTo(
                x + s[i]!,
                y + dy1,
                x + s[i]! + s[i + 1]!,
                y + dy1 + s[i + 2]!,
                x + s[i]! + s[i + 1]! + s[i + 3]!,
                y + dy1 + s[i + 2]!
              )
              dy1 = 0
            }
            stack.length = 0
            break
          }
          case 30:
          case 31: {
            const s = stack
            let h = v === 31
            for (let i = 0; i + 3 < s.length; i += 4) {
              const last = i + 5 === s.length ? s[i + 4]! : 0
              if (h)
                curveTo(
                  x + s[i]!,
                  y,
                  x + s[i]! + s[i + 1]!,
                  y + s[i + 2]!,
                  x + s[i]! + s[i + 1]! + last,
                  y + s[i + 2]! + s[i + 3]!
                )
              else
                curveTo(
                  x,
                  y + s[i]!,
                  x + s[i + 1]!,
                  y + s[i]! + s[i + 2]!,
                  x + s[i + 1]! + s[i + 3]!,
                  y + s[i]! + s[i + 2]! + last
                )
              h = !h
            }
            stack.length = 0
            break
          }
          case 10:
          case 29: {
            const subrs = v === 10 ? lsubrs : gsubrs
            const i = stack.pop()! + bias(subrs.length)
            const sr = subrs[i]
            if (sr && depth < 10 && run(sr[0], sr[1], depth + 1)) return true
            break
          }
          case 11:
            return false
          case 14:
            if (stack.length && !haveWidth) stack.shift()
            close()
            return true
          case 12: {
            const e = t.getUint8(p++)
            const s = stack
            if (e === 35) {
              curveTo(
                x + s[0]!,
                y + s[1]!,
                x + s[0]! + s[2]!,
                y + s[1]! + s[3]!,
                x + s[0]! + s[2]! + s[4]!,
                y + s[1]! + s[3]! + s[5]!
              )
              curveTo(
                x + s[6]!,
                y + s[7]!,
                x + s[6]! + s[8]!,
                y + s[7]! + s[9]!,
                x + s[6]! + s[8]! + s[10]!,
                y + s[7]! + s[9]! + s[11]!
              )
            } else if (e === 34) {
              const y0 = y
              curveTo(
                x + s[0]!,
                y,
                x + s[0]! + s[1]!,
                y + s[2]!,
                x + s[0]! + s[1]! + s[3]!,
                y + s[2]!
              )
              curveTo(x + s[4]!, y, x + s[4]! + s[5]!, y0, x + s[4]! + s[5]! + s[6]!, y0)
            } else if (e === 36) {
              const y0 = y
              curveTo(
                x + s[0]!,
                y + s[1]!,
                x + s[0]! + s[2]!,
                y + s[1]! + s[3]!,
                x + s[0]! + s[2]! + s[4]!,
                y + s[1]! + s[3]!
              )
              curveTo(x + s[5]!, y, x + s[5]! + s[6]!, y + s[7]!, x + s[5]! + s[6]! + s[8]!, y0)
            } else if (e === 37) {
              const x0 = x,
                y0 = y
              const dx = s[0]! + s[2]! + s[4]! + s[6]! + s[8]!,
                dy = s[1]! + s[3]! + s[5]! + s[7]! + s[9]!
              curveTo(
                x + s[0]!,
                y + s[1]!,
                x + s[0]! + s[2]!,
                y + s[1]! + s[3]!,
                x + s[0]! + s[2]! + s[4]!,
                y + s[1]! + s[3]! + s[5]!
              )
              const horiz = Math.abs(dx) > Math.abs(dy)
              curveTo(
                x + s[6]!,
                y + s[7]!,
                x + s[6]! + s[8]!,
                y + s[7]! + s[9]!,
                horiz ? x + s[6]! + s[8]! + s[10]! : x0 + dx,
                horiz ? y0 : y + s[7]! + s[9]! + s[10]!
              )
            }
            stack.length = 0
            break
          }
          default:
            stack.length = 0
        }
      }
      return false
    }
    const c = cs[g]
    if (c) run(c[0], c[1], 0)
    close()
    return path
  }
}

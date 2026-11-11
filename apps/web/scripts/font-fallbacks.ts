/**
 * Writes src/lib/shared/design/font-fallbacks.ts: for each bundled family, the
 * size and vertical metrics that make a font every visitor already has (Arial,
 * Times New Roman or Courier New) take the same room as the family. A portal
 * page draws its words in that adjusted face until the family's file arrives,
 * so the swap neither rewraps a line nor moves what sits below it.
 *
 * Widths are each face's average advance over English text at 400; the
 * ascent, descent and line gap are its hhea metrics, the ones browsers draw
 * a web font with. The system faces are read from Liberation Sans, Serif and
 * Mono, which are drawn to Arial's, Times New Roman's and Courier New's
 * metrics glyph for glyph.
 *
 * Usage: bun scripts/font-fallbacks.ts   (from apps/web; needs the Liberation fonts)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { woffTables, parseCmap } from '../src/lib/server/domains/design/extract/fonts/sfnt'
import { FACES, fontFileName } from '../src/lib/server/domains/design/extract/fonts/faces'
import { BUNDLED_FONT_IDS } from '../src/lib/shared/design/options'
import { BUNDLED_FONTS } from '../src/lib/shared/design/fonts'

/** Text like a portal's: words, capitals, numbers and punctuation, in English's proportions. */
const SAMPLE =
  'The quick brown fox jumps over the lazy dog. Share an idea, vote on what matters and follow ' +
  'what ships next. We read every post and reply within 2 days. Dark mode, CSV export and a ' +
  'Slack integration are on the Roadmap; 14 ideas are in progress. Sign in to comment.'

interface Metrics {
  upm: number
  ascent: number
  descent: number
  lineGap: number
  /** Average advance over SAMPLE, in em. */
  width: number
}

function readMetrics(file: string): Metrics {
  const tables = woffTables(new Uint8Array(readFileSync(file)))
  const head = tables.get('head')!
  const hhea = tables.get('hhea')!
  const hmtx = tables.get('hmtx')!
  const upm = head.getUint16(18)
  const advances = hhea.getUint16(34)
  const cmap = parseCmap(tables.get('cmap')!)
  const advance = (glyph: number) => hmtx.getUint16(Math.min(glyph, advances - 1) * 4)
  let total = 0
  for (const char of SAMPLE) total += advance(cmap.get(char.codePointAt(0)!) ?? 0)
  return {
    upm,
    ascent: hhea.getInt16(4),
    descent: hhea.getInt16(6),
    lineGap: hhea.getInt16(8),
    width: total / [...SAMPLE].length / upm,
  }
}

const SYSTEM = {
  sans: { local: ['Arial', 'Liberation Sans'], file: 'LiberationSans-Regular.ttf' },
  serif: { local: ['Times New Roman', 'Liberation Serif'], file: 'LiberationSerif-Regular.ttf' },
  mono: { local: ['Courier New', 'Liberation Mono'], file: 'LiberationMono-Regular.ttf' },
} as const

function systemFile(name: string): string {
  const found = execFileSync('fc-list', ['--format', '%{file}\n'], { encoding: 'utf8' })
    .split('\n')
    .find((file) => file.endsWith(`/${name}`))
  if (!found) throw new Error(`${name} is not installed (fonts-liberation)`)
  return found
}

const percent = (value: number) => Math.round(value * 10000) / 100

const fontsource = path.resolve(import.meta.dirname, '../node_modules/@fontsource')
const systems = Object.fromEntries(
  Object.entries(SYSTEM).map(([kind, { file }]) => [kind, readMetrics(systemFile(file))])
) as Record<keyof typeof SYSTEM, Metrics>

const rows: string[] = []
for (const id of BUNDLED_FONT_IDS) {
  // A system family is on the device already: nothing swaps in.
  if (BUNDLED_FONTS[id].category === 'system') continue
  const face = FACES.find((f) => f.id === id)
  if (!face) throw new Error(`no bundled face for ${id}`)
  const metrics = readMetrics(path.join(fontsource, face.pkg, 'files', fontFileName(face, 400)))
  const kind = face.top
  const size = metrics.width / systems[kind].width
  const scale = metrics.upm * size
  rows.push(
    `  ${/^[a-z]+$/.test(id) ? id : `'${id}'`}: { system: '${kind}', size: ${percent(size)}, ` +
      `ascent: ${percent(metrics.ascent / scale)}, descent: ${percent(Math.abs(metrics.descent) / scale)}, ` +
      `lineGap: ${percent(metrics.lineGap / scale)} },`
  )
}

const out = `/**
 * Written by scripts/font-fallbacks.ts; run it again after adding a bundled
 * family. For each family, how to size a font every visitor has so it takes
 * the family's room while the family's file loads: size-adjust, then the
 * ascent, descent and line gap overrides, as percentages.
 */
import type { BundledFontId } from './fonts'

export interface FallbackMetrics {
  /** Which system face stands in: Arial, Times New Roman or Courier New. */
  system: 'sans' | 'serif' | 'mono'
  size: number
  ascent: number
  descent: number
  lineGap: number
}

/** The system faces by name, and the same faces as Linux ships them. */
export const SYSTEM_FACES = {
${Object.entries(SYSTEM)
  .map(([kind, { local }]) => `  ${kind}: [${local.map((name) => `'${name}'`).join(', ')}],`)
  .join('\n')}
} as const

/** Every bundled family but the system ones, which never swap. */
export const FONT_FALLBACKS: Partial<Record<BundledFontId, FallbackMetrics>> = {
${rows.join('\n')}
}
`
const target = path.resolve(import.meta.dirname, '../src/lib/shared/design/font-fallbacks.ts')
writeFileSync(target, out)
console.log(`Wrote ${rows.length} families to ${path.relative(process.cwd(), target)}`)

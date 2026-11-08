/**
 * People call the top of each page the hero, so the builder never says
 * "band" where they read it: its outline, quick find, the block registry,
 * the looks, change names, checks, the AI composer's chips, and the words in
 * the builder's own components. (The design's stored keys keep the older
 * word; see schema.ts.)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCOPE_LABEL } from '@/components/admin/settings/appearance/design-composer'
import { blockOf, BLOCK_JOBS, SECTION_TYPES } from '@/lib/shared/design/blocks'
import { SHEET_TITLES } from '@/lib/shared/design/builder-chrome'
import { designChecks } from '@/lib/shared/design/checks'
import { colourPairs } from '@/lib/shared/design/colour-pairs'
import { BAND_LOOKS } from '@/lib/shared/design/curated'
import { HERO_AI_PATHS } from '@/lib/shared/design/hero'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { alsoChanges, changeGroup, changeLabel } from '@/lib/shared/design/labels'
import { outlineKeys, outlineOf, type DesignerPage } from '@/lib/shared/design/outline'
import { DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { quickFindItems } from '@/lib/shared/design/quick-find'
import { defaultDesign } from '@/lib/shared/design/schema'

const BAND = /\bband\b/i
const PAGES: DesignerPage[] = [
  'home',
  'feedback',
  'post',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
]

function designWithEverything() {
  const design = defaultDesign()
  design.nav.home.on = true
  design.layout.band = 'brand'
  design.layout.headerOnBand = true
  design.brand.light.support = '#0ea5e9'
  design.brand.bandImage = { key: 'portal-images/room.jpg' }
  return design
}

describe('the hero’s name in the builder’s words', () => {
  it('is never band in the outline, quick find or the block registry', () => {
    const design = designWithEverything()
    const words: string[] = []
    for (const page of PAGES) {
      const nodes = outlineOf(design, page)
      const walk = (list: typeof nodes) =>
        list.forEach((node) => {
          words.push(node.label)
          walk(node.children ?? [])
        })
      walk(nodes)
      for (const item of quickFindItems(nodes, page, PAGES))
        words.push(item.label, item.where ?? '')
      expect(outlineKeys(nodes)).not.toContain('band')
    }
    for (const type of [...DESIGN_OPTIONS.blockType, ...SECTION_TYPES, 'hero']) {
      const def = blockOf(type)!
      words.push(def.name, def.purpose, def.note ?? '')
      for (const field of def.fields) {
        words.push(field.label)
        if (field.kind === 'choice') words.push(...field.options.map(([, name]) => name))
      }
    }
    words.push(...Object.values(BLOCK_JOBS), ...Object.values(SHEET_TITLES))
    expect(words.filter((word) => BAND.test(word))).toEqual([])
  })

  it('is never band in the looks, presets, change names, checks or the AI’s chips', () => {
    const design = designWithEverything()
    const words = [
      ...BAND_LOOKS.map((look) => look.label),
      ...DESIGN_PRESETS.flatMap((preset) => [preset.label, preset.description]),
      ...[...HERO_AI_PATHS, 'layout.band', 'brand.bandImage.key'].flatMap((path) => [
        changeLabel(path),
        changeGroup(path),
      ]),
      alsoChanges('brand.light.support') ?? '',
      ...designChecks(design).map((check) => check.text),
      ...colourPairs(design).flatMap((pair) => [pair.text, pair.on]),
      ...Object.values(SCOPE_LABEL),
    ]
    expect(words.filter((word) => BAND.test(word))).toEqual([])
  })
})

/* The words in the builder's own components, read from their source. */

const SRC = join(import.meta.dirname, '..', '..', '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx$/.test(entry.name) ? [full] : []
  })
}

/**
 * What a person reads in a component: text between tags, and quoted words
 * that read as prose (a capital, then letters and spaces), never class names,
 * paths, keys or comments.
 */
function shownWords(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const text = [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]!.trim())
  const quoted = [...code.matchAll(/(['"`])([A-Z][A-Za-z’' ,.?!-]* [A-Za-z’' ,.?!-]*)\1/g)].map(
    (m) => m[2]!
  )
  return [...text, ...quoted]
}

describe('the builder’s components', () => {
  it('never show the word band', () => {
    const files = [
      ...sources(join(SRC, 'components', 'designer')),
      ...['focal-point.tsx', 'drawings.tsx', 'design-composer.tsx', 'home-section.tsx'].map(
        (name) => join(SRC, 'components', 'admin', 'settings', 'appearance', name)
      ),
    ]
    const found = files.flatMap((file) =>
      shownWords(readFileSync(file, 'utf8'))
        .filter((words) => BAND.test(words))
        .map((words) => `${relative(SRC, file)}: ${words}`)
    )
    expect(found).toEqual([])
  })

  it('reads prose the way a person sees it', () => {
    // The scan itself: it finds the word in shown text and quoted prose, and skips code.
    expect(
      shownWords(`<p>The band look</p> label="Top band" className="[[data-qb-band=none]_&]:py-0"`)
    ).toEqual(['The band look', 'Top band'])
  })
})

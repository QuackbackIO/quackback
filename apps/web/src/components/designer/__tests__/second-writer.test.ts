/**
 * One writer per design field. The builder's rule is that each property has
 * one home, and every other place shows a summary row that links to it. So
 * a design path is written by one editor component; a second component that
 * writes the same path is a second home, and this fails.
 *
 * It reads the builder's components (the designer and the Appearance
 * controls it still draws) for writes to the draft: `draft.a.b = …`,
 * `draft.a.b ??= …`, `delete draft.a.b`, and calls of the shared helpers that
 * write a field for them. Plain helpers in .ts files are not components:
 * a component calling one is the writer.
 *
 * The few paths written from two components today are listed, each with why
 * and what removes it. A listed path may lose a writer (the list then says
 * more than is true, which is harmless), never gain one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENTS = join(__dirname, '..', '..')
const ROOTS = [join(COMPONENTS, 'designer'), join(COMPONENTS, 'admin', 'settings', 'appearance')]

/** Shared helpers that write a field, by name: a component calling one writes that field. */
const HELPERS: Record<string, string> = {
  setIcon: 'brand.logo.mark',
  setTitle: 'brand.logo.name',
  showFullLogo: 'brand.logo.display',
  setLogoColours: 'brand.logoColours',
  setFeedWords: 'pages.feedback.copy',
}

/**
 * Paths two components write today, by the components (relative to
 * src/components) allowed to. Each says why, and the finding that ends it.
 */
const KNOWN: Record<string, { writers: readonly string[]; why: string }> = {
  'brand.fonts.heading': {
    writers: [
      'admin/settings/appearance/fonts-section.tsx',
      'designer/brand-kit-fonts.tsx',
      'designer/element-style-section.tsx',
    ],
    why: 'The heading font: brand kit fonts and the heading element (F49)',
  },
  'brand.fonts.display': {
    writers: [
      'admin/settings/appearance/fonts-section.tsx',
      'designer/brand-kit-fonts.tsx',
      'designer/element-style-section.tsx',
    ],
    why: 'The headline font: brand kit fonts and the headline element (F49)',
  },
  'brand.fonts.headingWeight': {
    writers: [
      'admin/settings/appearance/fonts-section.tsx',
      'designer/brand-kit-fonts.tsx',
      'designer/element-style-section.tsx',
    ],
    why: 'Heading weight: brand kit fonts, and the heading element matching it to a new heading font (F49)',
  },
  'brand.fonts.body': {
    writers: [
      'admin/settings/appearance/closest-face.tsx',
      'admin/settings/appearance/fonts-section.tsx',
      'designer/brand-kit-fonts.tsx',
    ],
    why: 'The font picker and its closest-face offer are parts of the brand kit fonts',
  },
  'layout.imagePoint': {
    writers: ['admin/settings/appearance/focal-point.tsx', 'designer/hero-panel.tsx'],
    why: 'The focal point control is a part of the hero panel, which also resets it',
  },
}

const WRITE =
  /(?<![\w.])(delete\s+)?draft\.(\w+(?:(?:\?\.|\.)\w+)*)\s*(=(?!=)|\?\?=)?|\b(\w+)\(draft\b/g

function components(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : components(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

/** The design paths a component's source writes. */
function writesIn(source: string): string[] {
  const paths = new Set<string>()
  for (const match of source.matchAll(WRITE)) {
    const [, del, path, assign, helper] = match
    if (helper) {
      if (HELPERS[helper]) paths.add(HELPERS[helper])
    } else if (del || assign) paths.add(path!.replace(/\?\./g, '.'))
  }
  return [...paths]
}

/** Every design path the builder's components write, by the components writing it. */
function writers(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of ROOTS.flatMap(components)) {
    const name = relative(COMPONENTS, file).split('\\').join('/')
    for (const path of writesIn(readFileSync(file, 'utf8')))
      found.set(path, [...(found.get(path) ?? []), name])
  }
  return found
}

describe('one writer per design field', () => {
  it('reads writes, deletes and the helpers that write a field, and nothing else', () => {
    expect(
      writesIn(`
        update((draft) => void (draft.layout.width = width))
        update((draft) => { delete draft.shape.hover })
        ;(draft.tune ??= {}).card = shadow
        update((draft) => setTitle(draft, value))
        if (draft.layout.width === 'wide') read(draft.mode)
      `).sort()
    ).toEqual(['brand.logo.name', 'layout.width', 'shape.hover', 'tune'])
  })

  it('finds a second component writing a field', () => {
    const found = new Map([['layout.width', ['designer/theme-sheet.tsx']]])
    const second = 'designer/page-panel.tsx'
    for (const path of writesIn('update((draft) => void (draft.layout.width = w))'))
      found.set(path, [...(found.get(path) ?? []), second])
    expect(seconds(found)).toEqual([
      'layout.width: designer/theme-sheet.tsx, designer/page-panel.tsx',
    ])
  })

  it('has no field with a second editor component, beyond the ones listed', () => {
    expect(seconds(writers())).toEqual([])
  })

  it('writes each logo field from the logo rows alone', () => {
    const found = writers()
    for (const path of [
      'brand.logo.mark',
      'brand.logo.name',
      'brand.logo.display',
      'brand.logo.height',
      'brand.logo.wordmark.light',
      'brand.logoColours',
    ])
      expect(found.get(path), path).toEqual(['designer/logo-rows.tsx'])
  })
})

/** Each path written by a component its entry does not allow, with every writer. */
function seconds(found: Map<string, string[]>): string[] {
  return [...found]
    .filter(([path, files]) => {
      if (files.length < 2) return false
      const allowed = KNOWN[path]?.writers
      return !allowed || files.some((file) => !allowed.includes(file))
    })
    .map(([path, files]) => `${path}: ${files.join(', ')}`)
}

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
 *
 * And one vocabulary for people and the AI: the builder changes Home's
 * blocks and the pages' parts by dispatching the design's operations
 * (lib/shared/design/dispatch.ts, through ./dispatcher), never by writing the
 * draft itself, so what the operations check and lay out always runs. A
 * direct write is a call of the draft's `update(…)` or a change function
 * handed a `draft`. The files still writing directly are listed with how
 * many writes each holds; a count may only go down, and a file not listed
 * may hold none.
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
    writers: ['admin/settings/appearance/fonts-section.tsx', 'designer/brand-kit-fonts.tsx'],
    why: 'The font picker is a part of the brand kit fonts',
  },
  'brand.fonts.display': {
    writers: ['admin/settings/appearance/fonts-section.tsx', 'designer/brand-kit-fonts.tsx'],
    why: 'The font picker is a part of the brand kit fonts',
  },
  'brand.fonts.headingWeight': {
    writers: ['admin/settings/appearance/fonts-section.tsx', 'designer/brand-kit-fonts.tsx'],
    why: 'The font picker is a part of the brand kit fonts',
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

/**
 * The direct writes each file still holds, and why. Every entry is a panel
 * that writes something other than Home's blocks and the pages' parts (theme,
 * brand kit, fonts, logo, element styles, menu, hero, backgrounds) or the
 * plumbing operations go through; each count only goes down, as its writes
 * become operations. Paths are relative to src/components.
 */
const DIRECT_WRITES: Record<string, { writes: number; why: string }> = {
  'designer/dispatcher.ts': { writes: 1, why: 'Where every operation reaches the draft' },
  'designer/use-designer-events.ts': {
    writes: 1,
    why: 'The counted update every panel is handed: it wraps the draft’s update',
  },
  'designer/versions-dialog.tsx': { writes: 1, why: 'Copies a whole version over the draft' },
  'designer/designer-shell.tsx': { writes: 1, why: 'Applies a check’s own fix' },
  'designer/designer-ai.tsx': { writes: 1, why: 'The hero image the AI pane uploads' },
  'admin/settings/appearance/use-design-ai.ts': { writes: 2, why: 'The AI’s logo changes' },
  'admin/settings/appearance/ask-ai-panel.tsx': { writes: 1, why: 'The AI’s brand changes' },
  'admin/settings/appearance/home-section.tsx': {
    writes: 2,
    why: 'Edits a copy of one Links block its caller hands it; picked-block dispatches the result',
  },
  'designer/brand-kit-colours.tsx': { writes: 5, why: 'Brand colours' },
  'designer/brand-kit-fonts.tsx': { writes: 6, why: 'Brand fonts' },
  'designer/brand-kit.tsx': { writes: 4, why: 'Brand kit images and logo' },
  'designer/brand-match-row.tsx': { writes: 1, why: 'A website’s brand applied' },
  'admin/settings/appearance/closest-face.tsx': { writes: 2, why: 'Brand fonts' },
  'admin/settings/appearance/fonts-section.tsx': { writes: 5, why: 'Brand fonts' },
  'designer/logo-rows.tsx': { writes: 8, why: 'The logo' },
  'admin/settings/appearance/logo-extras.ts': { writes: 1, why: 'The logo' },
  'designer/look-picker.tsx': { writes: 1, why: 'A theme look' },
  'designer/looks-entry.ts': { writes: 1, why: 'A look from Compare looks' },
  'designer/theme-sheet.tsx': { writes: 4, why: 'Theme' },
  'admin/settings/appearance/css-section.tsx': { writes: 1, why: 'Custom CSS' },
  'designer/element-panel.tsx': { writes: 5, why: 'Element styles' },
  'designer/element-style-section.tsx': { writes: 3, why: 'Element styles' },
  'designer/element-styles.tsx': { writes: 3, why: 'Element styles' },
  'designer/overrides-list.tsx': { writes: 1, why: 'Element style overrides' },
  'designer/header-panel.tsx': { writes: 3, why: 'The header' },
  'designer/menu-add.tsx': { writes: 1, why: 'The menu' },
  'designer/menu-link-form.tsx': { writes: 1, why: 'The menu' },
  'designer/menu-part-settings.tsx': { writes: 2, why: 'The menu' },
  'designer/use-menu-editing.ts': { writes: 4, why: 'The menu' },
  'designer/hero-panel.tsx': { writes: 5, why: 'The hero, which the AI sets by hero.set' },
  'admin/settings/appearance/focal-point.tsx': { writes: 1, why: 'The hero image’s focal point' },
  'designer/use-composer-width.ts': { writes: 3, why: 'The composer’s width in the hero' },
  'designer/page-background-settings.tsx': { writes: 2, why: 'Page backgrounds' },
  'designer/page-panel.tsx': { writes: 2, why: 'Page titles in the hero, a theme field' },
  'designer/inspector.tsx': {
    writes: 5,
    why: 'The feed page’s welcome switch, sort, opening board, post card fields and filters, which the AI sets by path',
  },
}

/** A draft's update called, or a change function handed the draft (not its type). */
const DIRECT =
  /\bupdate\(\s*(?:\(\s*\w+(?:\s*:\s*\w+)?\s*\)\s*=>|\w+\s*=>)?|\(\s*draft(?:\s*:\s*\w+)?\s*\)\s*=>(?!\s*void\s*(?:[),;|}\n]|$))|\bdraft\s*=>/g

/** How many direct writes a file's source holds. */
const directWrites = (source: string) => [...source.matchAll(DIRECT)].length

function builderFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : builderFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/** Each file's direct writes beyond what its entry allows, or that holds some unlisted. */
function overWritten(found: ReadonlyMap<string, number>): string[] {
  return [...found]
    .filter(([file, writes]) => writes > (DIRECT_WRITES[file]?.writes ?? 0))
    .map(([file, writes]) => `${file}: ${writes}, allowed ${DIRECT_WRITES[file]?.writes ?? 0}`)
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

describe('one vocabulary for the builder and the AI', () => {
  const found = () =>
    new Map(
      ROOTS.flatMap(builderFiles).map((file) => [
        relative(COMPONENTS, file).split('\\').join('/'),
        directWrites(readFileSync(file, 'utf8')),
      ])
    )

  it('counts updates and change functions, not their types or dispatched operations', () => {
    expect(
      directWrites(`
        type Update = (change: (draft: PortalDesign) => void, label?: string) => void
        update((draft) => void (draft.layout.width = width), 'Width')
        draft.update((next) => moveHomeBlock(next, id, 1))
        editing.update(
          (draft) => editGrid(draft, gates, id, change),
          'Move'
        )
        onFix={(check) => update(check.fix.apply, check.fix.label)}
        set((draft) => { draft.mode = 'dark' })
        dispatch({ op: 'block.set', block: id, key: 'count', value: 5 }, 'How many')
      `)
    ).toBe(5)
  })

  it('finds a panel that writes the draft beside the operations', () => {
    const found = new Map([['designer/block-sections.tsx', 1]])
    expect(overWritten(found)).toEqual(['designer/block-sections.tsx: 1, allowed 0'])
  })

  it('writes Home’s blocks and the pages’ parts only through operations', () => {
    expect(overWritten(found())).toEqual([])
  })

  it('lists each file with the writes it still holds, so the list only shrinks', () => {
    const now = found()
    const stale = Object.entries(DIRECT_WRITES)
      .filter(([file, { writes }]) => (now.get(file) ?? 0) !== writes)
      .map(([file, { writes }]) => `${file}: ${now.get(file) ?? 0}, listed ${writes}`)
    expect(stale).toEqual([])
  })
})

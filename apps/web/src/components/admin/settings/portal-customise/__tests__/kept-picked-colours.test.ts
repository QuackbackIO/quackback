/**
 * The colour an admin (or Import, or Ask) picks is the one kept and shown;
 * only what is drawn moves to read. The editor's stylesheet carries the
 * picked colour beside the drawn one while they differ, publish stores both,
 * and a reload shows the same picked colour.
 */
import { describe, expect, it } from 'vitest'
import { portalThemeSchema } from '@/lib/shared/schemas/portal-customise'
import { contrastRatio } from '@/lib/shared/theme/colour-setters'
import { extractCssVariables } from '@/lib/shared/theme/css-parser'
import { pickedColour } from '@/lib/shared/theme/base'
import type { BrandImport } from '@/lib/shared/theme/brand-import'
import { applyDraftPatch, summariseDraftForAsk } from '../ask-draft'
import { applyBrandImport, revertImportRow } from '../brand-apply'
import { summariseChange } from '../change-summary'
import { drawnNote, pickedHex } from '../colours'
import { portalSummary } from '../summary'
import {
  draftFromLoaded,
  draftPalette,
  draftRemainder,
  editTheme,
  publishInput,
  publishedFromLoaded,
  type LoadedPortal,
  type PortalDraft,
} from '../portal-draft'

function loaded(theme: LoadedPortal['theme'] = { themeMode: 'light' }): LoadedPortal {
  return {
    theme,
    customCss: '',
    portal: { nav: { items: [{ id: 'feedback', type: 'feedback' }] } } as LoadedPortal['portal'],
    helpCenter: null,
  } as unknown as LoadedPortal
}

const lightVars = (draft: PortalDraft) => extractCssVariables(draft.cssText).light

/** Publish a draft and load what was stored, as the editor does on its next visit. */
function publishAndReload(baseline: PortalDraft, draft: PortalDraft, from: LoadedPortal) {
  const input = publishInput(baseline, draft, publishedFromLoaded(from))!
  const theme = portalThemeSchema.parse(input.theme) as LoadedPortal['theme']
  const reloaded = draftFromLoaded(loaded(theme))
  return { theme, reloaded }
}

describe.each([
  ['#6366f1', '#6265f0'],
  ['#0d9488', '#00857a'],
])('the main colour %s', (picked, drawn) => {
  const start = draftFromLoaded(loaded())
  const draft = editTheme.setColour(start, 'primary', 'light', picked)

  it('is kept and shown, while buttons are drawn in the deeper fill', () => {
    expect(pickedHex(draftPalette(draft, 'light'), 'primary')).toBe(picked)
    expect(lightVars(draft)['--primary']).toBe(drawn)
    expect(lightVars(draft)['--picked-primary']).toBe(picked)
    expect(contrastRatio('#ffffff', drawn)).toBeGreaterThanOrEqual(4.5)
    expect(drawnNote(draftPalette(draft, 'light'), 'primary')).toBe(
      'Buttons are drawn a little deeper so their text reads.'
    )
  })

  it('is the colour the change summary, Ask and the Portal summary name', () => {
    const line = summariseChange(start, draft).lines[0]!
    expect(line.swatch).toBe(picked)
    expect(summariseDraftForAsk(draft).colours.light.main).toBe(picked)
    const rows = portalSummary({
      theme: publishAndReload(start, draft, loaded()).theme,
      customCss: '',
      portal: {},
      logoUrl: null,
      headerLogo: null,
      gatedTypes: new Set(),
    })
    expect(rows.find((row) => row.label === 'Main colour')!.value).toBe(picked)
  })

  it('is stored on publish, and comes back the same on reload and on later edits', () => {
    const input = publishInput(start, draft, publishedFromLoaded(loaded()))!
    // Theme lines only: nothing for Advanced CSS, so no plan check.
    expect(input.customCss).toBe('')
    const { theme, reloaded } = publishAndReload(start, draft, loaded())
    expect(theme.light).toMatchObject({ primary: drawn, pickedPrimary: picked })
    expect(reloaded.cssText).toBe(draft.cssText)
    expect(pickedHex(draftPalette(reloaded, 'light'), 'primary')).toBe(picked)
    // Edits elsewhere never move it.
    let next = editTheme.setRadius(reloaded, 1)
    next = editTheme.setColour(next, 'background', 'light', '#f5f7fb')
    next = editTheme.setFont(next, '"Geist Sans", ui-sans-serif, system-ui, sans-serif')
    expect(pickedHex(draftPalette(next, 'light'), 'primary')).toBe(picked)
    const again = publishAndReload(reloaded, next, loaded(theme)).reloaded
    expect(pickedHex(draftPalette(again, 'light'), 'primary')).toBe(picked)
    expect(again.cssText).toBe(next.cssText)
  })

  it('is what Ask sets', () => {
    const asked = applyDraftPatch(start, { colours: { light: { main: picked } } })
    expect(asked.cssText).toBe(draft.cssText)
  })

  it('goes when a colour that reads as it is is picked next', () => {
    const next = editTheme.setColour(draft, 'primary', 'light', '#1d4ed8')
    expect(lightVars(next)['--primary']).toBe('#1d4ed8')
    expect(lightVars(next)['--picked-primary']).toBeUndefined()
    expect(drawnNote(draftPalette(next, 'light'), 'primary')).toBeNull()
  })

  it('gives way to a main colour typed into the stylesheet by hand', () => {
    const typed = editTheme.setCssText(
      draft,
      draft.cssText.replace(`--primary: ${drawn};`, '--primary: #b91c1c;')
    )
    expect(pickedHex(draftPalette(typed, 'light'), 'primary')).toBe('#b91c1c')
    // Later edits keep it, and the picked line left behind is never Advanced CSS.
    const later = editTheme.setRadius(typed, 1)
    expect(pickedHex(draftPalette(later, 'light'), 'primary')).toBe('#b91c1c')
    expect(draftRemainder(later)).not.toContain('--picked-')
    expect(lightVars(later)['--picked-primary']).toBeUndefined()
  })
})

describe('page text picked too pale', () => {
  const start = draftFromLoaded(loaded())
  const draft = editTheme.setColour(start, 'foreground', 'light', '#bbbbbb')

  it('is kept and shown, while the text is drawn dark enough to read', () => {
    const palette = draftPalette(draft, 'light')
    expect(pickedHex(palette, 'foreground')).toBe('#bbbbbb')
    expect(contrastRatio(palette.foreground!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(drawnNote(palette, 'foreground')).toBe('Text is drawn darker so it reads.')
    expect(summariseDraftForAsk(draft).colours.light.text).toBe('#bbbbbb')
  })

  it('is stored and reloads the same', () => {
    const { theme, reloaded } = publishAndReload(start, draft, loaded())
    expect(theme.light?.pickedForeground).toBe('#bbbbbb')
    expect(pickedHex(draftPalette(reloaded, 'light'), 'foreground')).toBe('#bbbbbb')
    expect(reloaded.cssText).toBe(draft.cssText)
  })

  it('on Auto again, nothing is kept beside it', () => {
    const auto = editTheme.setColour(draft, 'foreground', 'light', null)
    expect(lightVars(auto)['--picked-foreground']).toBeUndefined()
  })
})

describe('a picked colour stored when it was drawn otherwise', () => {
  it('is kept when the theme would now draw it another way', () => {
    // As if the rules that drew it moved on since it was stored.
    const stored = draftFromLoaded(
      loaded({ themeMode: 'light', light: { primary: '#5b5fe8', pickedPrimary: '#6366f1' } })
    )
    expect(pickedHex(draftPalette(stored, 'light'), 'primary')).toBe('#6366f1')
    expect(lightVars(stored)['--primary']).toBe('#6265f0')
  })
})

describe('a theme saved before picked colours were kept', () => {
  it('shows its stored colour, and a theme that already reads carries no picked lines', () => {
    const old = draftFromLoaded(
      loaded({ themeMode: 'light', light: { primary: '#1d4ed8', foreground: '#111827' } })
    )
    expect(pickedHex(draftPalette(old, 'light'), 'primary')).toBe('#1d4ed8')
    expect(old.cssText).not.toContain('--picked-')
  })

  it('saved as drawn by the last editor, it stays as it is', () => {
    const old = draftFromLoaded(loaded({ themeMode: 'light', light: { primary: '#6265f0' } }))
    expect(pickedHex(draftPalette(old, 'light'), 'primary')).toBe('#6265f0')
    expect(old.cssText).not.toContain('--picked-')
  })
})

describe('Import', () => {
  const site: BrandImport = {
    host: 'example.com',
    reader: 'static',
    primary: '#6366f1',
    background: '#ffffff',
    scheme: 'light',
    font: { id: 'inter', exact: true },
    tokens: { mutedForeground: '#b0b0b0' },
    missing: [],
  }
  const start = draftFromLoaded(loaded())
  const imported = applyBrandImport(start, site)

  it('keeps the site’s colours as picked, drawn to read', () => {
    const palette = draftPalette(imported, 'light')
    expect(pickedHex(palette, 'primary')).toBe('#6366f1')
    expect(palette.primary).toBe('#6265f0')
    expect(pickedColour(palette, 'mutedForeground')).toBe('#b0b0b0')
    expect(contrastRatio(palette.mutedForeground!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('taken back, leaves the colours as they were, with no picked line left behind', () => {
    const back = revertImportRow(revertImportRow(imported, start, 'primary'), start, 'page')
    expect(back.cssText).toBe(start.cssText)
    expect(back.cssText).not.toContain('--picked-')
  })

  it('taken back over a colour picked before, restores that one', () => {
    const before = editTheme.setColour(start, 'primary', 'light', '#0d9488')
    const back = revertImportRow(applyBrandImport(before, site), before, 'primary')
    expect(pickedHex(draftPalette(back, 'light'), 'primary')).toBe('#0d9488')
    expect(lightVars(back)['--primary']).toBe(lightVars(before)['--primary'])
    expect(lightVars(back)['--picked-primary']).toBe('#0d9488')
  })
})

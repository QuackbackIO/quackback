/**
 * A theme keeps the colours picked beside the ones drawn: expansion works
 * from the picked colour and, for the editor, says what was picked where the
 * drawn one differs. The live theme CSS never carries the picked colours, and
 * a theme drawn as picked, or stored without them, renders as it always did.
 */
import { describe, expect, it } from 'vitest'
import { MINIMAL_THEME_VARIABLE_KEYS, PICKED_KEYS, pickedColour } from '../base'
import { expandTheme, unbrandedTheme } from '../expand'
import { generateWorkspaceThemeCSS } from '../generator'
import { generateReadableCSS } from '../readable-css'
import { brandingPatchSchema } from '@/lib/shared/schemas/settings'
import { portalThemeSchema } from '@/lib/shared/schemas/portal-customise'

describe('expandTheme with picked colours', () => {
  it('draws #6366f1 deeper for white words and says it was picked', () => {
    const vars = expandTheme({ primary: '#6366f1' }, { mode: 'light', picked: true })
    expect(vars.primary).toBe('#6265f0')
    expect(vars.pickedPrimary).toBe('#6366f1')
  })

  it('works from the picked colour over the drawn one beside it', () => {
    const stored = { primary: '#6265f0', pickedPrimary: '#6366f1' }
    expect(expandTheme(stored, { mode: 'light' })).toEqual(
      expandTheme({ primary: '#6366f1' }, { mode: 'light' })
    )
    // Pale text: drawn darker, the picked shade kept.
    const pale = expandTheme({ foreground: '#bbbbbb' }, { mode: 'light', picked: true })
    expect(pale.pickedForeground).toBe('#bbbbbb')
    expect(pale.foreground).not.toBe('#bbbbbb')
  })

  it('says nothing of picked colours drawn as they are', () => {
    for (const [mode, primary] of [
      ['light', '#1d4ed8'],
      ['dark', '#60a5fa'],
    ] as const) {
      const theme = { ...unbrandedTheme(mode), primary }
      const plain = expandTheme(theme, { mode })
      expect(expandTheme(theme, { mode, picked: true })).toEqual(plain)
      for (const picked of Object.values(PICKED_KEYS)) expect(plain).not.toHaveProperty(picked)
    }
    const css = generateReadableCSS(
      { ...unbrandedTheme('light'), primary: '#1d4ed8' },
      { ...unbrandedTheme('dark'), primary: '#60a5fa' },
      'user'
    )
    expect(css).not.toContain('--picked-')
  })

  it('never writes picked colours without being asked', () => {
    const vars = expandTheme({ primary: '#6366f1', foreground: '#bbbbbb' }, { mode: 'light' })
    for (const picked of Object.values(PICKED_KEYS)) expect(vars).not.toHaveProperty(picked)
  })
})

describe('the live theme CSS', () => {
  const picked = {
    themeMode: 'user' as const,
    light: { primary: '#6265f0', pickedPrimary: '#6366f1', foreground: '#767676' },
    dark: { primary: '#00857a', pickedPrimary: '#0d9488', pickedForeground: '#333333' },
  }

  it('never carries the picked colours', () => {
    expect(generateWorkspaceThemeCSS(picked)).not.toContain('picked')
  })

  it('is the same for a theme stored with the colour picked, as drawn, or as both', () => {
    const live = (primary: Record<string, string>) =>
      generateWorkspaceThemeCSS({ themeMode: 'light', light: primary })
    const asPicked = live({ primary: '#6366f1' })
    expect(live({ primary: '#6265f0' })).toBe(asPicked)
    expect(live({ primary: '#6265f0', pickedPrimary: '#6366f1' })).toBe(asPicked)
  })
})

describe('picked colours as stored', () => {
  it('are theme variables both the settings and the publish schemas take', () => {
    for (const picked of Object.values(PICKED_KEYS))
      expect(MINIMAL_THEME_VARIABLE_KEYS).toContain(picked)
    const light = { primary: '#6265f0', pickedPrimary: '#6366f1', pickedForeground: '#bbbbbb' }
    expect(brandingPatchSchema.parse({ light })).toEqual({ light })
    expect(portalThemeSchema.parse({ light })).toEqual({ light })
  })

  it('name the colour picked, else the one set', () => {
    expect(pickedColour({ primary: '#6265f0', pickedPrimary: '#6366f1' }, 'primary')).toBe(
      '#6366f1'
    )
    expect(pickedColour({ primary: '#1d4ed8' }, 'primary')).toBe('#1d4ed8')
  })
})

/**
 * An assistant's branding change merges over the stored theme. A colour it
 * sets is the one picked now: a colour kept as picked beside it would be
 * drawn in its place, so it goes.
 */
import { describe, expect, it } from 'vitest'
import { withoutPicksSetBy } from '../settings-proposals.service'
import { areaValues } from '../settings-proposals.areas'

describe('withoutPicksSetBy', () => {
  const stored = {
    themeMode: 'user' as const,
    light: { primary: '#6265f0', pickedPrimary: '#6366f1', pickedForeground: '#bbbbbb' },
    dark: { primary: '#00857a', pickedPrimary: '#0d9488' },
  }

  it('drops the picked colour for each colour the patch sets, on its side only', () => {
    expect(withoutPicksSetBy(stored, { light: { primary: '#b91c1c' } })).toEqual({
      themeMode: 'user',
      light: { primary: '#6265f0', pickedForeground: '#bbbbbb' },
      dark: { primary: '#00857a', pickedPrimary: '#0d9488' },
    })
  })

  it('keeps it where the patch repeats the colour as stored, or sets other colours', () => {
    expect(withoutPicksSetBy(stored, { light: { primary: '#6265f0' } })).toEqual(stored)
    expect(withoutPicksSetBy(stored, { dark: { background: '#0b1220' } })).toEqual(stored)
  })
})

describe('the branding a settings change reads', () => {
  it('shows each colour as picked, and never the picked-colour variables', () => {
    const row = {
      brandingConfig: JSON.stringify({
        light: { primary: '#6265f0', pickedPrimary: '#6366f1' },
      }),
      logoKey: null,
    } as unknown as Parameters<typeof areaValues>[0]
    const light = areaValues(row, 'branding').light as Record<string, unknown>
    expect(light.primary).toBe('#6366f1')
    expect(light).not.toHaveProperty('pickedPrimary')
  })
})

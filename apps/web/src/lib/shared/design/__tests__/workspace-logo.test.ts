/** A publish offers the portal's logo to the admin and emails only once it is new and emails can show it. */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
import { newWorkspaceLogo } from '../workspace-logo'

const withMark = (key: string | null) => {
  const design = defaultDesign()
  design.brand.logo.mark.light = key ? { key } : null
  return design
}

describe('newWorkspaceLogo', () => {
  it('is the draft’s light logo once it differs from the live one', () => {
    expect(newWorkspaceLogo(withMark(null), withMark('header-logos/a.png'))).toBe(
      'header-logos/a.png'
    )
    expect(newWorkspaceLogo(withMark('header-logos/a.png'), withMark('header-logos/a.png'))).toBe(
      null
    )
    expect(newWorkspaceLogo(withMark('header-logos/a.png'), withMark(null))).toBe(null)
  })

  it('is never an SVG, which many email apps do not show', () => {
    expect(newWorkspaceLogo(withMark(null), withMark('header-logos/a.SVG'))).toBe(null)
  })
})

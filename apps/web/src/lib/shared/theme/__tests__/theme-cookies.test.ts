/**
 * The portal and the admin keep separate light or dark choices. A visitor who
 * chose before the split keeps that choice on the portal until they choose
 * again there.
 */
import { describe, expect, it } from 'vitest'
import { getPortalThemeCookie, getThemeCookie } from '../index'

describe('theme cookies', () => {
  it('reads each choice from its own cookie', () => {
    const header = 'theme=dark; portal-theme=light'
    expect(getThemeCookie(header)).toBe('dark')
    expect(getPortalThemeCookie(header)).toBe('light')
  })

  it('falls back to the shared choice until the portal has its own', () => {
    expect(getPortalThemeCookie('theme=dark')).toBe('dark')
    expect(getPortalThemeCookie('portal-theme=nonsense; theme=light')).toBe('light')
    expect(getPortalThemeCookie(null)).toBe('system')
  })

  it('does not let the portal choice change the admin one', () => {
    expect(getThemeCookie('portal-theme=dark')).toBe('system')
  })
})

import { describe, expect, it } from 'vitest'
import { shouldReusePortalSession } from '../portal-session-reuse'

describe('shouldReusePortalSession', () => {
  it('reuses the session for a same-origin document navigation', () => {
    expect(shouldReusePortalSession({ site: 'same-origin', mode: 'navigate' })).toBe(true)
  })

  it.each([
    ['same-site', 'navigate'],
    ['cross-site', 'navigate'],
    ['none', 'navigate'],
    ['SAME-ORIGIN', 'navigate'],
    ['', 'navigate'],
  ])('does not reuse it when Sec-Fetch-Site is %j', (site, mode) => {
    expect(shouldReusePortalSession({ site, mode })).toBe(false)
  })

  it('does not reuse it when Sec-Fetch-Site is missing', () => {
    expect(shouldReusePortalSession({ site: null, mode: 'navigate' })).toBe(false)
    expect(shouldReusePortalSession({ site: undefined, mode: 'navigate' })).toBe(false)
  })

  it.each([['cors'], ['same-origin'], ['no-cors'], [null]])(
    'does not reuse it for a same-origin request in mode %j (a call from inside the frame)',
    (mode) => {
      expect(shouldReusePortalSession({ site: 'same-origin', mode })).toBe(false)
    }
  )
})

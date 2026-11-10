// @vitest-environment happy-dom
/**
 * The visitor beacon counts portal visits. A shared preview link's URL holds
 * its token, so such a page is never sent, nor is the admin's framed preview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const state = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  href: '/',
}))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({
      location: { search: state.search, href: state.href },
      matches: [{ routeId: '/_portal/' }],
    }),
}))

const { VisitorBeacon } = await import('../visitor-beacon')

const sendBeacon = vi.fn(() => true)
beforeEach(() => {
  sendBeacon.mockClear()
  vi.stubGlobal('navigator', { ...navigator, sendBeacon, doNotTrack: null })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VisitorBeacon', () => {
  it('counts a portal visit', () => {
    state.search = {}
    state.href = '/'
    render(<VisitorBeacon />)
    expect(sendBeacon).toHaveBeenCalledTimes(1)
  })

  it('never sends a page opened from a shared preview link', () => {
    state.search = { share: `qbp_${'a'.repeat(43)}` }
    state.href = `/?share=qbp_${'a'.repeat(43)}`
    render(<VisitorBeacon />)
    expect(sendBeacon).not.toHaveBeenCalled()
  })
})

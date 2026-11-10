// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

const router = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => router.search,
  useNavigate: () => router.navigate,
}))
const ai = vi.hoisted(() => ({ available: true }))
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useSuspenseQuery: () => ({ data: { available: ai.available } }),
}))

const { arrivalAction, useMatchOnArrival } = await import('../use-match-on-arrival')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  router.search = {}
  ai.available = true
})

describe('arrivalAction', () => {
  it('matches the website named on arrival when AI is set up', () => {
    expect(arrivalAction({ match: 'acme.com', aiAvailable: true })).toEqual({
      kind: 'match',
      site: 'acme.com',
    })
  })

  it('opens the Brand kit when AI is not set up', () => {
    expect(arrivalAction({ match: 'acme.com', aiAvailable: false })).toEqual({ kind: 'brand-kit' })
  })

  it('opens the Brand kit when the match names no website', () => {
    expect(arrivalAction({ match: 'not a site', aiAvailable: true })).toEqual({
      kind: 'brand-kit',
    })
  })

  it('opens the Brand kit from onboarding without a website', () => {
    expect(arrivalAction({ from: 'onboarding', aiAvailable: true })).toEqual({
      kind: 'brand-kit',
    })
  })

  it("opens the Brand kit's match row from Settings > Portal's Match your brand", () => {
    expect(arrivalAction({ from: 'appearance', brand: 'match', aiAvailable: true })).toEqual({
      kind: 'brand-kit',
    })
    expect(arrivalAction({ from: 'appearance', aiAvailable: true })).toBeNull()
  })

  it("opens publish from onboarding's matched brand waiting in the draft", () => {
    expect(arrivalAction({ publish: 'open', from: 'onboarding', aiAvailable: true })).toEqual({
      kind: 'publish',
    })
    expect(arrivalAction({ publish: 'open', from: 'onboarding', aiAvailable: false })).toEqual({
      kind: 'publish',
    })
  })

  it('does nothing on an ordinary visit', () => {
    expect(arrivalAction({ from: 'portal', aiAvailable: true })).toBeNull()
    expect(arrivalAction({ aiAvailable: true })).toBeNull()
  })
})

describe('useMatchOnArrival', () => {
  const hooks = () => ({
    start: vi.fn(),
    showAi: vi.fn(),
    openBrandKit: vi.fn(),
    openPublish: vi.fn(),
  })

  it('runs the brand match once, into Ask AI, and clears the address so a reload does not', () => {
    router.search = { match: 'acme.com', from: 'onboarding' }
    const on = hooks()
    const { rerender } = renderHook(() => useMatchOnArrival(on))
    rerender()
    expect(on.start).toHaveBeenCalledOnce()
    expect(on.start).toHaveBeenCalledWith('acme.com')
    expect(on.showAi).toHaveBeenCalledOnce()
    expect(on.openBrandKit).not.toHaveBeenCalled()
    expect(router.navigate).toHaveBeenCalledOnce()
    const call = router.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, string>) => Record<string, string | undefined>
      replace: boolean
    }
    expect(call.replace).toBe(true)
    expect(call.search({ match: 'acme.com', from: 'onboarding', path: '/' })).toEqual({
      path: '/',
      match: undefined,
      from: undefined,
    })
  })

  it('opens the Brand kit instead when AI is not set up', () => {
    router.search = { match: 'acme.com', from: 'onboarding' }
    ai.available = false
    const on = hooks()
    renderHook(() => useMatchOnArrival(on))
    expect(on.start).not.toHaveBeenCalled()
    expect(on.openBrandKit).toHaveBeenCalledOnce()
  })

  it('clears the Brand kit request from the address once it opened', () => {
    router.search = { from: 'appearance', brand: 'match' }
    const on = hooks()
    renderHook(() => useMatchOnArrival(on))
    expect(on.openBrandKit).toHaveBeenCalledOnce()
    const call = router.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, string>) => Record<string, string | undefined>
    }
    expect(call.search({ from: 'appearance', brand: 'match', path: '/' }).brand).toBeUndefined()
  })

  it('opens publish once, and clears the request from the address', () => {
    router.search = { publish: 'open', from: 'onboarding' }
    const on = hooks()
    const { rerender } = renderHook(() => useMatchOnArrival(on))
    rerender()
    expect(on.openPublish).toHaveBeenCalledOnce()
    expect(on.start).not.toHaveBeenCalled()
    expect(on.openBrandKit).not.toHaveBeenCalled()
    const call = router.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, string>) => Record<string, string | undefined>
    }
    expect(call.search({ publish: 'open', from: 'onboarding', path: '/' }).publish).toBeUndefined()
  })

  it('leaves an ordinary visit alone', () => {
    router.search = { from: 'portal' }
    const on = hooks()
    renderHook(() => useMatchOnArrival(on))
    expect(on.start).not.toHaveBeenCalled()
    expect(on.openBrandKit).not.toHaveBeenCalled()
    expect(on.openPublish).not.toHaveBeenCalled()
    expect(router.navigate).not.toHaveBeenCalled()
  })
})

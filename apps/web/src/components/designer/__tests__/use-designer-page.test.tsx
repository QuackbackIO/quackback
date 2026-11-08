// @vitest-environment happy-dom
/**
 * A sample is something to look at while designing, never a page of the
 * portal: the page picker names it while it shows, but Review's pages and
 * its before-and-after frames only ever hold the portal's real pages.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'

const settings = vi.hoisted(() => ({
  featureFlags: { feedback: true, changelog: false, helpCenter: false },
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (options: { select: (context: unknown) => unknown }) =>
    options.select({ settings }),
}))
vi.mock('@/lib/server/functions/portal-designer', () => ({
  listDesignerPostsFn: vi.fn(async () => ({ ok: true, posts: [] })),
}))

import { useDesignerPage } from '../use-designer-page'

function view(returnPath = '/roadmap') {
  return renderHook(() => useDesignerPage(returnPath, defaultDesign()))
}

describe('useDesignerPage and samples', () => {
  it('names a shown sample in the page picker but keeps it out of the real pages', () => {
    const { result } = view()
    expect(result.current.pages).not.toContain('changelog')
    act(() => result.current.showSample('changelog'))
    expect(result.current.page).toBe('changelog')
    expect(result.current.shownPages).toContain('changelog')
    expect(result.current.pages).not.toContain('changelog')
    // Review opens on the real page the builder was on.
    expect(result.current.realPage).toBe('roadmap')
  })

  it('keeps the real page under a sample of a part that is on', () => {
    settings.featureFlags = { ...settings.featureFlags, changelog: true }
    const { result } = view('/changelog')
    act(() => result.current.showSample('changelog'))
    expect(result.current.realPage).toBe('changelog')
    expect(result.current.pages.filter((page) => page === 'changelog')).toHaveLength(1)
    settings.featureFlags = { ...settings.featureFlags, changelog: false }
  })

  it('shows the not-found sample over the page the builder was on, which the panels keep', () => {
    const { result } = view()
    act(() => result.current.showSample('not-found'))
    expect(result.current.sample).toBe('not-found')
    expect(result.current.page).toBe('roadmap')
    expect(result.current.shownPages).not.toContain('not-found')
    expect(result.current.here).toEqual({ page: 'roadmap', item: null })
  })
})

describe('useDesignerPage and the widget', () => {
  it('shows the widget over the page, and a page or a sample gives it way', () => {
    const { result } = view()
    act(() => result.current.showWidget())
    expect(result.current.widget).toBe(true)
    // The panels stay on the page the builder was on.
    expect(result.current.page).toBe('roadmap')
    act(() => result.current.setPage('feedback'))
    expect(result.current.widget).toBe(false)
    act(() => result.current.showWidget())
    act(() => result.current.showSample('changelog'))
    expect(result.current.widget).toBe(false)
  })
})

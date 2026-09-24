// @vitest-environment happy-dom

/**
 * The admin roadmap page shows the first roadmap until one is picked. That
 * default is derived, not written into the URL: a navigation on mount ran
 * every route guard again (three server requests) just to repeat what the
 * page already showed.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
let search: { roadmap?: string; post?: string } = {}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('@/routes/admin/roadmap', () => ({
  Route: { useSearch: () => search },
}))

const { useRoadmapSelection } = await import('../use-roadmap-selection')

const ROADMAPS = [{ id: 'roadmap_first' }, { id: 'roadmap_second' }]

beforeEach(() => {
  navigate.mockClear()
  search = {}
})

describe('useRoadmapSelection', () => {
  it('selects the first roadmap without navigating when the URL names none', () => {
    const { result } = renderHook(() => useRoadmapSelection(ROADMAPS))

    expect(result.current.selectedRoadmapId).toBe('roadmap_first')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('selects the roadmap the URL names', () => {
    search = { roadmap: 'roadmap_second' }
    const { result } = renderHook(() => useRoadmapSelection(ROADMAPS))

    expect(result.current.selectedRoadmapId).toBe('roadmap_second')
  })

  it('selects nothing until the roadmaps load, or when there are none', () => {
    expect(renderHook(() => useRoadmapSelection(undefined)).result.current.selectedRoadmapId).toBe(
      null
    )
    expect(renderHook(() => useRoadmapSelection([])).result.current.selectedRoadmapId).toBe(null)
  })

  it('writes a picked roadmap into the URL, keeping the rest of the search', () => {
    search = { post: 'post_1' }
    const { result } = renderHook(() => useRoadmapSelection(ROADMAPS))

    result.current.setSelectedRoadmap('roadmap_second')

    expect(navigate).toHaveBeenCalledWith({
      to: '/admin/roadmap',
      search: { post: 'post_1', roadmap: 'roadmap_second' },
      replace: true,
    })
  })
})

// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const navigateMock = vi.fn()
let routerSearch: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/routes/_portal/index', () => ({
  Route: {
    useSearch: () => routerSearch,
  },
}))

import { usePublicFilters } from '../use-public-filters'

describe('usePublicFilters', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    routerSearch = {}
  })

  it('counts each new filter type once in activeFilterCount', () => {
    routerSearch = {
      status: ['open'],
      tagIds: ['tag_1', 'tag_2'],
      minVotes: 10,
      dateFrom: '2026-04-01',
      responded: 'responded',
    }
    const { result } = renderHook(() => usePublicFilters())

    // status (1) + tagIds (2) + minVotes (1) + dateFrom (1) + responded (1) = 6
    expect(result.current.activeFilterCount).toBe(6)
    expect(result.current.hasActiveFilters).toBe(true)
  })

  it('clearFilters removes status, tags, minVotes, dateFrom, responded but preserves search/sort/board', () => {
    routerSearch = {
      board: 'feature-requests',
      search: 'login',
      sort: 'new',
      status: ['open'],
      tagIds: ['tag_1'],
      minVotes: 10,
      dateFrom: '2026-04-01',
      responded: 'responded',
    }
    const { result } = renderHook(() => usePublicFilters())

    act(() => {
      result.current.clearFilters()
    })

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/',
        search: expect.objectContaining({
          board: 'feature-requests',
          sort: 'new',
          search: 'login',
          status: undefined,
          tagIds: undefined,
          minVotes: undefined,
          dateFrom: undefined,
          responded: undefined,
        }),
      })
    )
  })

  it('setFilters writes new filter fields to the URL', () => {
    routerSearch = { sort: 'top' }
    const { result } = renderHook(() => usePublicFilters())

    act(() => {
      result.current.setFilters({ minVotes: 25 })
    })

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ minVotes: 25 }),
      })
    )
  })
})

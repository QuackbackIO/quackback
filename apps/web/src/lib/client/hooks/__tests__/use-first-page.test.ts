// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { InfiniteData } from '@tanstack/react-query'
import { useFirstPage } from '../use-portal-posts-query'

type Page = { page: number; facets?: string }

function data(pageParams: number[]): InfiniteData<Page> {
  return {
    pages: pageParams.map((page) => ({ page, ...(page === 1 && { facets: 'counts' }) })),
    pageParams,
  }
}

describe('useFirstPage', () => {
  it('reads the first page while it is cached', () => {
    const { result } = renderHook(() => useFirstPage(data([1, 2])))
    expect(result.current).toEqual({ page: 1, facets: 'counts' })
  })

  it('keeps the first page once later pages push it out of the cache', () => {
    const { result, rerender } = renderHook((props) => useFirstPage(props), {
      initialProps: data([1, 2, 3]),
    })
    rerender(data([2, 3, 4]))
    expect(result.current?.facets).toBe('counts')
  })

  it('moves to a new first page when one arrives', () => {
    const { result, rerender } = renderHook((props) => useFirstPage(props), {
      initialProps: data([1]),
    })
    rerender({ pages: [{ page: 1, facets: 'new counts' }], pageParams: [1] })
    expect(result.current?.facets).toBe('new counts')
  })
})

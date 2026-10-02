// @vitest-environment happy-dom
/**
 * A joined-date filter is a calendar date range ("2026-10-01"). Read as a
 * moment it is UTC midnight, still Sep 30 in Los Angeles, so the chip must
 * show the days as written, for every viewer.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { UsersActiveFiltersBar } from '../users-active-filters-bar'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

describe('UsersActiveFiltersBar date chip', () => {
  it('shows a date range as the days it names, west of UTC', () => {
    setRuntimeLocale('en-US', 'America/Los_Angeles')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UsersActiveFiltersBar
          filters={{ dateFrom: '2026-10-01', dateTo: '2026-10-31' } as never}
          onFiltersChange={() => {}}
          onClearFilters={() => {}}
        />
      </QueryClientProvider>
    )
    expect(screen.getByText(/Oct 1, 2026 - Oct 31, 2026/)).toBeInTheDocument()
  })
})

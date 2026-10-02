// @vitest-environment happy-dom
/**
 * A date filter is a calendar date ("2026-10-01"). Read as a moment it is UTC
 * midnight, which is still Sep 30 in Los Angeles, so the chip must show the
 * day as written, for every viewer.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { ActiveFiltersBar } from '../active-filters-bar'
import type { InboxFilters } from '../use-inbox-filters'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

describe('ActiveFiltersBar date chip', () => {
  it('shows a date filter as the day it names, west of UTC', () => {
    setRuntimeLocale('en-US', 'America/Los_Angeles')
    render(
      <ActiveFiltersBar
        filters={{ dateFrom: '2026-10-01' } as InboxFilters}
        onFiltersChange={() => {}}
        onClearAll={() => {}}
        boards={[]}
        tags={[]}
        statuses={[]}
        members={[]}
      />
    )
    expect(screen.getByText(/Oct 1, 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Sep 30, 2026/)).not.toBeInTheDocument()
  })
})

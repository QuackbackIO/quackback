// @vitest-environment happy-dom
/**
 * A date filter is a calendar date ("2024-03-01"). Read as a moment it is UTC
 * midnight, which is still Feb 29 in Los Angeles, so the chip must show the
 * day as written, for every viewer.
 *
 * The date is long past on purpose: a date some number of days before today
 * matches a preset and renders as its label ("Last 7 days") instead.
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
        filters={{ dateFrom: '2024-03-01' } as InboxFilters}
        onFiltersChange={() => {}}
        onClearAll={() => {}}
        boards={[]}
        tags={[]}
        statuses={[]}
        members={[]}
      />
    )
    expect(screen.getByText(/Mar 1, 2024/)).toBeInTheDocument()
    expect(screen.queryByText(/Feb 29, 2024/)).not.toBeInTheDocument()
  })
})

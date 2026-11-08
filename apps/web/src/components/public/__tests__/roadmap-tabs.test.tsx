// @vitest-environment happy-dom
/**
 * The roadmap's tabs are the design's Tabs and filters: marked as tabs, the
 * chosen one selected, and with the button corners rather than a fixed pill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { RoadmapTabs } from '../roadmap-tabs'
import { FilterPill } from '../feedback/filter-pill'

afterEach(cleanup)

describe('the roadmap’s tabs', () => {
  it('are tabs the design styles, the chosen one selected', () => {
    render(
      <IntlProvider locale="en">
        <RoadmapTabs
          roadmaps={[
            { id: 'a', name: 'Now' },
            { id: 'b', name: 'Later' },
          ]}
          selectedId="b"
          onSelect={vi.fn()}
        />
      </IntlProvider>
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('data-qb-part'))).toEqual(['tab', 'tab'])
    expect(screen.getByRole('tab', { name: 'Later' }).getAttribute('aria-selected')).toBe('true')
    for (const tab of tabs) expect(tab.className).toContain('rounded-item')
  })
})

describe('a filter pill', () => {
  it('is a tab the design styles, pressed when on, with the button corners', () => {
    render(
      <FilterPill pressed onClick={vi.fn()}>
        Planned
      </FilterPill>
    )
    const pill = screen.getByRole('button', { name: 'Planned' })
    expect(pill.getAttribute('data-qb-part')).toBe('tab')
    expect(pill.getAttribute('aria-pressed')).toBe('true')
    expect(pill.className).toContain('rounded-item')
    expect(pill.className).not.toContain('rounded-full')
  })
})

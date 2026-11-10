// @vitest-environment happy-dom
/**
 * On a phone the roadmap's Search and Filter buttons show only their icons.
 * Their words stay for screen readers (sr-only), never display:none, so each
 * button keeps its name.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PublicRoadmapToolbar } from '../public-roadmap-toolbar'
import { PublicRoadmapToolbarFilterButton } from '../public-roadmap-filters-bar'

/** The words a button is named by: present, and hidden on phones only visually. */
function expectNamedOnPhones(name: string) {
  const button = screen.getByRole('button', { name })
  const label = [...button.querySelectorAll('span')].find((s) => s.textContent === name)!
  expect(label.className).toContain('sr-only')
  expect(label.className).toContain('sm:not-sr-only')
  expect(label.className.split(/\s+/)).not.toContain('hidden')
}

describe('roadmap toolbar buttons on a phone', () => {
  it('keep Search and Filter as their names', () => {
    render(
      <IntlProvider locale="en">
        <PublicRoadmapToolbar
          currentSort="votes"
          onSortChange={() => {}}
          onSearchChange={() => {}}
          filterButton={
            <PublicRoadmapToolbarFilterButton
              boards={[]}
              tags={[]}
              onToggleBoard={() => {}}
              onToggleTag={() => {}}
            />
          }
        />
      </IntlProvider>
    )
    expectNamedOnPhones('Search')
    expectNamedOnPhones('Filter')
  })
})

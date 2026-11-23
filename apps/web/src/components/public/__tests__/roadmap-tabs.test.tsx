// @vitest-environment happy-dom
/**
 * The roadmap's tabs. The chosen tab sits on the theme's quiet fill, as the
 * board's chosen sort does: the theme keeps its text readable there, which it
 * cannot promise of a tint of the text colour itself.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { RoadmapTabs } from '../roadmap-tabs'

describe('RoadmapTabs', () => {
  const roadmaps = [
    { id: 'a', name: 'Product Roadmap' },
    { id: 'b', name: 'Mobile' },
  ]
  it('draws the chosen tab on the quiet fill, in the text colour', () => {
    render(
      <IntlProvider locale="en">
        <RoadmapTabs roadmaps={roadmaps} selectedId="a" onSelect={vi.fn()} />
      </IntlProvider>
    )
    const chosen = screen.getByRole('tab', { name: 'Product Roadmap' })
    expect(chosen.getAttribute('aria-selected')).toBe('true')
    expect(chosen.className).toContain('bg-muted')
    expect(chosen.className).toContain('text-foreground')
    expect(chosen.className).not.toContain('bg-foreground/')
    expect(screen.getByRole('tab', { name: 'Mobile' }).className).toContain('text-muted-foreground')
  })
})

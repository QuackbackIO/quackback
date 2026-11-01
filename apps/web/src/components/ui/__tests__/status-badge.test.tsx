// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusBadge, StatusColourContext } from '../status-badge'

afterEach(cleanup)

describe('StatusBadge', () => {
  it('paints the dot from the status colour, marked for a design’s status style', () => {
    render(<StatusBadge name="Planned" color="#3b82f6" />)
    const badge = screen.getByText('Planned')
    const dot = badge.querySelector('[data-qb-status-dot]') as HTMLElement
    expect(dot.className).toContain('bg-[var(--qb-status)]')
    expect(badge.style.getPropertyValue('--qb-status')).toBe('#3b82f6')
  })

  it('shows the colour the page maps it to', () => {
    render(
      <StatusColourContext.Provider value={() => '#36c5f0'}>
        <StatusBadge name="Planned" color="#3b82f6" />
      </StatusColourContext.Provider>
    )
    const badge = screen.getByText('Planned')
    expect(badge.style.getPropertyValue('--qb-status')).toBe('#36c5f0')
  })
})

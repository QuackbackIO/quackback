// @vitest-environment happy-dom
/**
 * A dot on its own follows the page's status colours, as a status badge does,
 * so a filter or a roadmap column reads in the brand's colours or the ink.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StatusColourContext, StatusColourDot } from '../status-badge'

describe('a status colour dot', () => {
  it('paints from the colour the page shows, marked for the design’s status style', () => {
    const { container } = render(
      <StatusColourContext.Provider value={() => '#163300'}>
        <StatusColourDot colour="#3b82f6" />
      </StatusColourContext.Provider>
    )
    const dot = container.querySelector<HTMLElement>('[data-qb-status-dot]')!
    expect(dot.style.getPropertyValue('--qb-status')).toBe('#163300')
    expect(dot.className).toContain('bg-[var(--qb-status)]')
  })

  it('is muted without a colour', () => {
    const { container } = render(<StatusColourDot colour={null} />)
    expect(container.querySelector('[data-qb-status-dot]')!.className).toContain(
      'bg-muted-foreground'
    )
  })
})

// @vitest-environment happy-dom
/**
 * A panel's trail and ⋯ menu are drawn again only when they change, yet a
 * crumb or an action always runs the handler of the latest draw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PropertiesPanel } from '../properties/properties-panel'

afterEach(cleanup)

describe('PropertiesPanel’s title', () => {
  it('runs the latest crumb handler after a draw that kept the trail', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const panel = (onSelect: () => void) => (
      <PropertiesPanel
        crumbs={[{ label: 'Home' }, { label: 'Hero', onSelect }, { label: 'Headline' }]}
        title="Headline"
      >
        <p>rows</p>
      </PropertiesPanel>
    )
    const { rerender } = render(panel(first))
    rerender(panel(latest))
    fireEvent.click(screen.getByRole('button', { name: 'Hero' }))
    expect(latest).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })
})

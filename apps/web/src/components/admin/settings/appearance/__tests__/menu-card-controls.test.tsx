// @vitest-environment happy-dom
/** The menu's text colour, and a raised card's shadow, as tiles that write the design. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { CardStyleControls, MenuStyleControls } from '../section-controls'

afterEach(cleanup)

const harness = (design: PortalDesign) => {
  const update = (change: (draft: PortalDesign) => void) => change(design)
  return { design, update }
}

describe('menu text', () => {
  it('starts grey and sets the text colour', () => {
    const h = harness(defaultDesign())
    render(<MenuStyleControls {...h} />)
    const group = screen.getByRole('radiogroup', { name: 'Menu text' })
    expect(group.querySelector('[data-selected="true"]')!.textContent).toBe('Grey')
    fireEvent.click(within(group).getByRole('radio', { name: 'Text colour' }))
    expect(h.design.layout.navText).toBe('ink')
  })
})

describe('a raised card’s shadow', () => {
  it('shows only for raised cards, starts lifted, and sets an exact shadow', () => {
    const h = harness(defaultDesign())
    render(<CardStyleControls {...h} />)
    expect(screen.queryByRole('radiogroup', { name: 'Shadow' })).toBeNull()
    cleanup()
    h.design.layout.cards = 'raised'
    render(<CardStyleControls {...h} />)
    const group = screen.getByRole('radiogroup', { name: 'Shadow' })
    expect(group.querySelector('[data-selected="true"]')!.textContent).toBe('Lifted')
    fireEvent.click(within(group).getByRole('radio', { name: 'Floating' }))
    expect(h.design.tune?.card?.shadow).toBe('floating')
  })
})

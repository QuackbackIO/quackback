// @vitest-environment happy-dom
/**
 * Hover is none until chosen; Lift is written as element Hover values, so it
 * has one source, and going back to none leaves no field;
 * the menu's position is offered only for an inline header.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { HoverControls, MenuAlignControls } from '../motion-controls'

afterEach(cleanup)

const editing = (design: PortalDesign) => (change: (draft: PortalDesign) => void) => change(design)

describe('HoverControls', () => {
  it('writes Lift as post cards’ and main buttons’ hover, and None takes it back', () => {
    const design = defaultDesign()
    const { rerender } = render(<HoverControls design={design} update={editing(design)} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Lift' }))
    // One source: the element Hover values, never a motion of its own.
    expect(design.shape).not.toHaveProperty('hover')
    expect(design.style).toEqual({
      postCard: { hover: { lift: 2, shadow: 'floating' } },
      button: { hover: { lift: 2, shadow: 'floating' } },
    })
    rerender(<HoverControls design={design} update={editing(design)} />)
    expect(screen.getByRole('radio', { name: 'Lift' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'None' }))
    expect(design.shape).not.toHaveProperty('hover')
    expect(design.style).toBeUndefined()
  })

  it('keeps an element’s own hover when Lift goes, and shows Lift for a lift set on post cards', () => {
    const design = defaultDesign()
    design.style = { postCard: { hover: { lift: 4, borderColor: 'accent' } } }
    const { rerender } = render(<HoverControls design={design} update={editing(design)} />)
    expect(screen.getByRole('radio', { name: 'Lift' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Arrow' }))
    expect(design.shape.hover).toBe('arrow')
    expect(design.style).toEqual({ postCard: { hover: { borderColor: 'accent' } } })
    rerender(<HoverControls design={design} update={editing(design)} />)
    expect(screen.getByRole('radio', { name: 'Arrow' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('MenuAlignControls', () => {
  it('is offered for an inline header only', () => {
    const design = defaultDesign()
    render(<MenuAlignControls design={design} update={editing(design)} />)
    expect(screen.queryByRole('radiogroup', { name: 'Menu position' })).toBeNull()
    cleanup()
    design.layout.header = 'inline'
    render(<MenuAlignControls design={design} update={editing(design)} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Centred' }))
    expect(design.layout.menuAlign).toBe('centre')
  })
})

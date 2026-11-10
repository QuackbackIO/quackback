// @vitest-environment happy-dom
/**
 * Hover motion is none until chosen, and going back to none leaves no field;
 * the menu's position is offered only for an inline header.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { HoverControls, MenuAlignControls } from '../motion-controls'

afterEach(cleanup)

const editing = (design: PortalDesign) => (change: (draft: PortalDesign) => void) => change(design)

describe('HoverControls', () => {
  it('sets a hover motion, and none removes it', () => {
    const design = defaultDesign()
    const { rerender } = render(<HoverControls design={design} update={editing(design)} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Lift' }))
    expect(design.shape.hover).toBe('lift')
    rerender(<HoverControls design={design} update={editing(design)} />)
    fireEvent.click(screen.getByRole('radio', { name: 'None' }))
    expect(design.shape).not.toHaveProperty('hover')
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

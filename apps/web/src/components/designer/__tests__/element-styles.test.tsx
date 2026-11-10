// @vitest-environment happy-dom
/**
 * An element style editor: its states and the registry's fields, and a
 * preview drawn with the design's CSS that shows the state picked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { ElementStyleEditor, SITE_STYLE } from '../element-styles'

afterEach(cleanup)

/** The main buttons' editor, on the site's sheet. */
const Editor = (props: {
  design: PortalDesign
  update: (change: (draft: PortalDesign) => void) => void
}) => <ElementStyleEditor element="button" scope={SITE_STYLE} {...props} />

function harness(design: PortalDesign) {
  const box = { design }
  const update = (change: (draft: PortalDesign) => void) => {
    const draft = structuredClone(box.design)
    change(draft)
    box.design = portalDesign.parse(draft)
  }
  return { box, update }
}

describe('an element style editor', () => {
  it('sets a hover fill by role, and the preview draws the hover state with the design’s CSS', () => {
    const { box, update } = harness(defaultDesign())
    const view = render(<Editor design={box.design} update={update} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Hover' }))
    fireEvent.change(screen.getByLabelText('Background', { selector: 'select' }), {
      target: { value: 'support' },
    })
    expect(box.design.style?.button?.hover?.background).toBe('support')
    view.rerender(<Editor design={box.design} update={update} />)
    const preview = screen.getByTestId('style-preview')
    expect(preview.querySelector('style')!.textContent).toContain('--qb-st-button-hover-background')
    expect(preview.querySelector('[data-qb-force=hover]')).not.toBeNull()
    expect(screen.getByText('Hover', { selector: 'figcaption' })).toBeTruthy()
  })

  it('offers only what a state allows, and clears a value back to the theme', () => {
    const d = defaultDesign()
    d.style = { button: { base: { radius: 6 } } }
    const { box, update } = harness(portalDesign.parse(d))
    render(<Editor design={box.design} update={update} />)
    expect(screen.queryByLabelText('Focus ring', { selector: 'select' })).toBeNull()
    expect(screen.queryByLabelText('Lift (px)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear corners (px)' }))
    expect(box.design.style).toEqual({})
  })
})

describe('the state switch', () => {
  it('sets five or six states three to a row, so no name is cut', () => {
    const { box, update } = harness(defaultDesign())
    render(<Editor design={box.design} update={update} />)
    const group = screen.getByRole('radiogroup', { name: 'State' })
    expect(group.className).toContain('grid-cols-3')
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['Normal', 'Hover', 'Pressed', 'Focus', 'Disabled'])
  })
})

describe('typing a number', () => {
  it('keeps what is typed, applying it once in range, and brings it into range on leaving', () => {
    const { box, update } = harness(defaultDesign())
    const view = render(<Editor design={box.design} update={update} />)
    const weight = () => screen.getByLabelText('Weight') as HTMLInputElement
    // Typing 700 passes through 7 and 70 on the way, both under the least weight.
    for (const key of '700') {
      fireEvent.change(weight(), { target: { value: weight().value + key } })
      view.rerender(<Editor design={box.design} update={update} />)
    }
    expect(weight().value).toBe('700')
    expect(box.design.style?.button?.base?.weight).toBe(700)
    fireEvent.change(weight(), { target: { value: '1200' } })
    fireEvent.blur(weight())
    view.rerender(<Editor design={box.design} update={update} />)
    expect(box.design.style?.button?.base?.weight).toBe(900)
    expect(weight().value).toBe('900')
  })
})

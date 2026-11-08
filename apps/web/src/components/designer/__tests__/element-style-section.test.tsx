// @vitest-environment happy-dom
/**
 * An element's Style section: the brand's choices for it as tiles, each a
 * named undo step, a choice an exact value takes the place of left unpicked
 * until picked again, and nothing for an element with no choices.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import { ElementStyleSection } from '../element-style-section'

afterEach(cleanup)

function mount(element: StyleElement, start: PortalDesign = defaultDesign()) {
  const box = { design: start, labels: [] as Array<string | undefined> }
  const update = (change: (draft: PortalDesign) => void, label?: string) => {
    const draft = structuredClone(box.design)
    change(draft)
    box.design = portalDesign.parse(draft)
    box.labels.push(label)
    view.rerender(panel())
  }
  const panel = () => (
    <ElementStyleSection element={element} name="Thing" design={box.design} update={update} />
  )
  const view = render(panel())
  return { box, view }
}

describe('an element’s Style section', () => {
  it('sets the menu’s and buttons’ capitals from menu items, as a named step', () => {
    const { box } = mount('navItem')
    fireEvent.click(
      screen.getByRole('radiogroup', { name: 'Capitals' }).querySelector('[role=radio]:last-child')!
    )
    expect(box.design.brand.fonts.labelCase).toBe('upper')
    expect(box.labels.at(-1)).toBe('Thing: capitals, everywhere')
  })

  it('gives a headline scale back from an exact size when picked', () => {
    const design = defaultDesign()
    design.tune = { headline: { size: 60, weight: 600 } }
    const { box } = mount('headline', design)
    expect(screen.getByRole('radio', { name: 'Standard' }).getAttribute('aria-checked')).toBe(
      'false'
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }))
    expect(box.design.brand.fonts.scale).toBe('large')
    // Only what took the scale's place is cleared.
    expect(box.design.tune).toEqual({ headline: { weight: 600 } })
  })

  it('holds a post card title’s exact size, its only home', () => {
    const { box } = mount('postCard')
    fireEvent.change(screen.getByLabelText('Title size'), { target: { value: '18' } })
    expect(box.design.tune).toEqual({ card: { titleSize: 18 } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset title size' }))
    expect(box.design.tune).toBeUndefined()
  })

  it('is not there for an element with no brand choices', () => {
    const { view } = mount('input')
    expect(view.container.innerHTML).toBe('')
  })
})

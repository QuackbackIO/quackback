// @vitest-environment happy-dom
/**
 * An element's Style section: the brand's choices that are no one
 * property's, as tiles, each a named undo step; a choice that sets one
 * property is that property's row instead. Picking a choice clears the exact
 * values that took its place. Nothing for an element with no such choices.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import { ElementStyleSection, applyChoice, rowChoiceOf } from '../element-style-section'

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
  it('sets a menu’s look from menu items, as a named step', () => {
    const { box } = mount('navItem')
    fireEvent.click(screen.getByRole('radio', { name: 'Pills' }))
    expect(box.design.layout.nav).toBe('pills')
    expect(box.labels.at(-1)).toBe('Thing: menu, everywhere')
  })

  it('leaves a choice that sets one property to that property’s row', () => {
    mount('navItem')
    expect(screen.queryByRole('radiogroup', { name: 'Capitals' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Text' })).toBeNull()
    cleanup()
    mount('headline')
    expect(screen.queryByRole('radiogroup', { name: 'Scale' })).toBeNull()
    expect(rowChoiceOf(defaultDesign(), 'headline', 'size')?.label).toBe('Scale')
    expect(rowChoiceOf(defaultDesign(), 'button', 'radius')?.label).toBe('Shape')
  })

  it('gives a headline scale back from an exact size when picked, in either layer', () => {
    const design = defaultDesign()
    design.tune = { headline: { size: 60, weight: 600 } }
    design.style = { headline: { base: { size: 64 } } }
    applyChoice(design, 'headline', rowChoiceOf(design, 'headline', 'size')!, 'large')
    expect(design.brand.fonts.scale).toBe('large')
    // Only what took the scale's place is cleared.
    expect(design.tune).toEqual({ headline: { weight: 600 } })
    expect(design.style).toBeUndefined()
  })

  it('holds a post card title’s exact size, its only home', () => {
    const { box } = mount('card')
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

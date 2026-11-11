/**
 * The operations on brand, style and menu: one change each, with refusals
 * said plainly and the draft left as it was.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignOp, type DesignOp } from '../dispatch'
import { menuParts } from '../menu'
import { defaultDesign } from '../schema'
import { findOverride } from '../style-overrides'

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function run(op: DesignOp, design = defaultDesign()) {
  const before = structuredClone(design)
  const result = applyDesignOp(design, op)
  return { design, before, result }
}

describe('brand operations', () => {
  it('sets a brand colour by its role, in light or dark', () => {
    const light = run({ op: 'brand.colour', role: 'support', value: '#f2a900' })
    expect(light.result.ok).toBe(true)
    expect(light.design.brand.light.support).toBe('#f2a900')
    const dark = run({ op: 'brand.colour', role: 'accent', value: '#8fb8ff', mode: 'dark' })
    expect(dark.design.brand.dark?.accent).toBe('#8fb8ff')
  })

  it('takes away an optional colour, and refuses to take away a required one', () => {
    const design = defaultDesign()
    design.brand.light.support = '#f2a900'
    expect(
      run({ op: 'brand.colour', role: 'support', value: null }, design).design.brand.light.support
    ).toBeUndefined()
    const refused = run({ op: 'brand.colour', role: 'accent', value: null })
    expect(refused.result).toEqual({ ok: false, refusal: expect.stringContaining('accent') })
    expect(refused.design).toEqual(refused.before)
  })

  it('sets the heading or body font', () => {
    const { design } = run({ op: 'brand.font', slot: 'heading', font: 'lora' as never })
    expect(design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'lora' })
    expect(design.brand.fonts.body).toEqual(defaultDesign().brand.fonts.body)
  })

  it('sets the logo title', () => {
    expect(run({ op: 'logo.title', title: 'Acme Help' }).design.brand.logo.name).toBe('Acme Help')
  })
})

describe('style.set', () => {
  it('sets an element everywhere', () => {
    const { design, result } = run({
      op: 'style.set',
      element: 'button',
      state: 'hover',
      prop: 'background',
      value: 'ink',
    })
    expect(result.ok).toBe(true)
    expect(design.style?.button?.hover?.background).toBe('ink')
  })

  it('sets an element for one page and for one part', () => {
    const page = run({
      op: 'style.set',
      element: 'button',
      prop: 'background',
      value: 'ink',
      scope: 'page:roadmap',
    })
    expect(findOverride(page.design, 'page:roadmap:button')?.style?.base?.background).toBe('ink')
    const part = run({
      op: 'style.set',
      element: 'button',
      prop: 'background',
      value: 'ink',
      scope: 'part:hero.home.cta',
    })
    expect(findOverride(part.design, 'part:hero.home.cta:button')?.style?.base?.background).toBe(
      'ink'
    )
  })

  it('refuses a property the element does not take, changing nothing', () => {
    const { design, before, result } = run({
      op: 'style.set',
      element: 'button',
      state: 'hover',
      prop: 'nonsense',
      value: '1',
    })
    expect(result.ok).toBe(false)
    expect(design).toEqual(before)
  })
})

describe('menu operations', () => {
  const ids = (design: ReturnType<typeof defaultDesign>) =>
    menuParts(design, gates).map((part) => part.id)

  it('renames, hides and moves a page in the menu', () => {
    const design = defaultDesign()
    applyDesignOp(design, { op: 'menu.rename', item: 'roadmap', name: 'Plans', gates })
    applyDesignOp(design, { op: 'menu.shown', item: 'status', shown: false, gates })
    applyDesignOp(design, { op: 'menu.move', item: 'changelog', place: 0, gates })
    const parts = menuParts(design, gates)
    expect(parts.find((p) => p.id === 'roadmap')?.label).toBe('Plans')
    expect(parts.find((p) => p.id === 'status')?.shown).toBe(false)
    expect(ids(design).filter((id) => id !== 'home')[0]).toBe('changelog')
  })

  it('adds a link and removes it', () => {
    const design = defaultDesign()
    expect(
      applyDesignOp(design, { op: 'menu.addLink', label: 'Docs', url: 'https://acme.test/docs' }).ok
    ).toBe(true)
    const link = ids(design).find((id) => id.startsWith('link:'))!
    expect(link).toBeTruthy()
    applyDesignOp(design, { op: 'menu.removeLink', item: link })
    expect(ids(design).some((id) => id.startsWith('link:'))).toBe(false)
  })

  it('refuses an item the menu does not have, and a link with no web address', () => {
    expect(run({ op: 'menu.rename', item: 'nowhere', name: 'X', gates }).result.ok).toBe(false)
    expect(run({ op: 'menu.removeLink', item: 'link:none' }).result.ok).toBe(false)
    const bad = run({ op: 'menu.addLink', label: 'Docs', url: 'javascript:alert(1)' })
    expect(bad.result.ok).toBe(false)
    expect(bad.design).toEqual(bad.before)
  })
})

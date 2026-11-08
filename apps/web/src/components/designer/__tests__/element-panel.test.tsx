// @vitest-environment happy-dom
/**
 * A picked element's properties, on the shared frame: the trail to it, a
 * change shared by default with the one-offs offered and counted, its states
 * always shown with a dot where they hold values, rows grouped with Edge and
 * Shadow added on demand, each unset row saying what it has and where from,
 * and the places set differently at the foot. Each change is one named undo
 * step at the scope picked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { findOverride } from '@/lib/shared/design/style-overrides'
import type { StyleState } from '@/lib/shared/design/style-tokens'
import { ElementPanel } from '../element-panel'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

const cta = { element: 'button', part: 'hero.home.cta', section: 'hero', index: 0 } as const
const vote = { element: 'vote', part: null, section: 'block-abcdefgh', index: 1 } as const
const headline = { element: 'headline', part: null, section: null, index: 0 } as const
const link = { element: 'link', part: null, section: 'block-abcdefgh', index: 0 } as const

function home(): PortalDesign {
  return portalDesign.parse({
    ...defaultDesign(),
    pages: {
      ...defaultDesign().pages,
      home: {
        headline: null,
        blocks: [
          {
            type: 'ideas',
            id: 'abcdefgh',
            sort: 'top',
            count: 3,
            grid: { x: 0, y: 0, w: 6, h: 2 },
          },
        ],
      },
    },
  })
}

function mount(
  pick: typeof cta | typeof vote | typeof headline | typeof link,
  design = home(),
  extra: {
    reach?: { page: number; block: number | null }
    screen?: 'all' | 'phone'
    shared?: boolean
    initialScope?: 'block'
  } = {}
) {
  const box = { design, labels: [] as Array<string | undefined>, state: 'base' as StyleState }
  const update = (change: (draft: PortalDesign) => void, label?: string) => {
    const draft = structuredClone(box.design)
    change(draft)
    box.design = portalDesign.parse(draft)
    box.labels.push(label)
    view.rerender(panel())
  }
  const onState = (state: StyleState) => {
    box.state = state
    view.rerender(panel())
  }
  const panel = () => (
    <ElementPanel
      pick={pick}
      page="home"
      blockName={pick.section === 'hero' ? 'Hero' : 'Top posts'}
      design={box.design}
      update={update}
      state={box.state}
      onState={onState}
      screen={extra.screen ?? 'all'}
      onScreen={() => {}}
      onUp={() => {}}
      reach={extra.reach}
      shared={extra.shared}
      initialScope={extra.initialScope}
    />
  )
  const view = render(panel())
  return { box, view }
}

const line = (view: ReturnType<typeof render>) =>
  view.container.querySelector('[data-scope-line] p')!.textContent

describe('the picked element’s properties', () => {
  it('shows the trail, and starts every pick shared, offering the one-offs it has', () => {
    const { view } = mount(cta)
    expect(screen.getByRole('navigation', { name: 'Where it is' }).textContent).toBe(
      'HomeHeroCall to action'
    )
    expect(line(view)).toBe('Changing every main button')
    expect(screen.getByRole('button', { name: 'Just this one' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'This page' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'This block' })).toBeNull()
    cleanup()
    const again = mount(vote)
    expect(line(again.view)).toBe('Changing every vote box')
    expect(screen.queryByRole('button', { name: 'Just this one' })).toBeNull()
    expect(screen.getByRole('button', { name: 'This block' })).toBeTruthy()
  })

  it('counts what the page shows, and says the count is the page’s', () => {
    const { view } = mount(vote, home(), { reach: { page: 3, block: 2 } })
    expect(line(view)).toBe('Changing every vote box (3 on this page)')
    expect(screen.getByRole('button', { name: 'This block (2)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'This page (3)' }))
    expect(line(view)).toBe('Changing vote boxes on Home (3)')
    fireEvent.click(screen.getByRole('button', { name: 'Back to every vote box' }))
    expect(line(view)).toBe('Changing every vote box (3 on this page)')
  })

  it('groups the rows, adds Edge and Shadow with "+", and keeps the rarest under a closed More', () => {
    const { view } = mount(cta)
    for (const title of ['Fill', 'Text', 'Shape', 'Edge', 'Shadow'])
      expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Corners' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Style' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add edge' }))
    expect(screen.getByRole('radiogroup', { name: 'Style' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove edge' })).toBeTruthy()
    const more = view.container.querySelector('details')!
    expect(more.open).toBe(false)
    expect(more.contains(screen.getByLabelText('Letter spacing'))).toBe(true)
    expect(more.contains(screen.getByRole('radiogroup', { name: 'Corners' }))).toBe(false)
  })

  it('always shows the states, with a dot on each that holds values', () => {
    const design = home()
    design.style = { button: { hover: { background: 'support' } } }
    mount(cta, design)
    const hover = screen.getByRole('radio', { name: /^Hover/ })
    expect(hover.textContent).toBe('Hover, set')
    expect(hover.querySelector('[data-state-dot]')).toBeTruthy()
    expect(
      screen.getByRole('radio', { name: 'Normal' }).querySelector('[data-state-dot]')
    ).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Pressed' }))
  })

  it('writes at the scope picked, shared at first, as one named undo step', () => {
    const { box } = mount(cta)
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '40' } })
    // Every main button's height is its exact value: one home, nothing in the style.
    expect(box.design.tune).toEqual({ button: { height: 40 } })
    expect(box.design.style).toBeUndefined()
    expect(box.labels.at(-1)).toBe('Call to action · Hero: height, everywhere')
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '18' } })
    expect(
      findOverride(box.design, { scope: 'part', part: 'hero.home.cta', element: 'button' })?.style
    ).toEqual({ base: { size: 18 } })
    expect(box.labels.at(-1)).toBe('Call to action · Hero: size, this one')
  })

  it('shows an unset value as what it has, says where from, and resets a set one to it', () => {
    const design = home()
    design.style = { button: { base: { radius: 6 } } }
    const { box, view } = mount(cta, design)
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    const corners = screen.getByLabelText('Corners') as HTMLInputElement
    expect(corners.value).toBe('')
    expect(corners.placeholder).toBe('6')
    expect(view.container.querySelector('[title="From every main button"]')).toBeTruthy()
    fireEvent.change(corners, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to 6 px from every main button' }))
    expect(box.design.overrides).toBeUndefined()
  })

  it('shows what the brand gives where nothing is set, never a blank', () => {
    const design = home()
    design.shape.buttons = 'pill'
    const { view } = mount(cta, design)
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    expect((screen.getByLabelText('Corners') as HTMLInputElement).placeholder).toBe('999')
    expect(view.container.querySelector('[title="From brand"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Background: Brand colour' })).toBeTruthy()
    expect(view.container.textContent).not.toContain('As the theme')
  })

  it('stores a brand colour by its role', async () => {
    const { box } = mount(cta)
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Background' })).getByRole('radio', {
        name: 'Custom',
      })
    )
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Custom background: Brand colour' }))
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    expect(box.design.style).toEqual({ button: { base: { background: 'ink' } } })
  })

  it('lists the places set differently only when there are some, each with Reset', () => {
    const { box, view } = mount(cta)
    expect(view.container.textContent).not.toContain('Set differently')
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    fireEvent.change(screen.getByLabelText('Corners'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to every main button' }))
    expect(view.container.textContent).toContain('Set differently in 1 place')
    expect(view.container.textContent).toContain('Call to action · Hero: corners 4 px')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Call to action · Hero' }))
    expect(box.design.overrides).toBeUndefined()
    expect(view.container.textContent).not.toContain('Set differently')
  })

  it('says phone values are shown, with the way back', () => {
    const { view } = mount(cta, home(), { screen: 'phone' })
    expect(view.container.textContent).toContain('Phone values · All screens')
    expect(screen.queryByRole('heading', { name: 'Fill' })).toBeNull()
  })
})

describe('the brand’s choices and exact values, in the same panel', () => {
  const style = () => within(screen.getByRole('heading', { name: 'Style' }).closest('section')!)
  const tiles = (name: string) => within(screen.getByRole('radiogroup', { name }))

  it('gives each property one row: the brand’s choices as tiles, and Custom for an exact value', () => {
    const { box } = mount(cta)
    // No Shape tiles above a Corners row: the shapes are the Corners row's.
    expect(screen.queryByRole('radiogroup', { name: 'Shape' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Fill' })).toBeNull()
    expect(
      tiles('Corners')
        .getAllByRole('radio')
        .map((t) => t.textContent)
    ).toEqual(['Match', 'Sharp', 'Round', 'Pill', 'Custom'])
    expect(tiles('Corners').getByRole('radio', { name: 'Match', checked: true })).toBeTruthy()
    expect(screen.queryByLabelText('Custom corners')).toBeNull()
    fireEvent.click(tiles('Corners').getByRole('radio', { name: 'Pill' }))
    expect(box.design.shape.buttons).toBe('pill')
    expect(box.labels.at(-1)).toBe('Call to action · Hero: corners, everywhere')
    fireEvent.click(tiles('Corners').getByRole('radio', { name: 'Custom' }))
    const exact = screen.getByLabelText('Custom corners') as HTMLInputElement
    expect(exact.placeholder).toBe('999')
    fireEvent.change(exact, { target: { value: '6' } })
    expect(box.design.tune).toEqual({ button: { radius: 6 } })
    expect(tiles('Corners').getByRole('radio', { name: 'Custom', checked: true })).toBeTruthy()
  })

  it('shows an exact value as Custom with its number, and a choice picked again clears it', () => {
    const design = home()
    design.tune = { button: { radius: 14 } }
    // An older design's style copy goes too.
    design.style = { button: { base: { radius: 20 } } }
    const { box } = mount(cta, design)
    expect(tiles('Corners').getByRole('radio', { name: 'Custom', checked: true })).toBeTruthy()
    expect((screen.getByLabelText('Custom corners') as HTMLInputElement).value).toBe('20')
    fireEvent.click(tiles('Corners').getByRole('radio', { name: 'Round' }))
    expect(box.design.tune).toBeUndefined()
    expect(box.design.style).toBeUndefined()
    expect(box.design.shape.buttons).toBe('rounded')
    expect(screen.queryByLabelText('Custom corners')).toBeNull()
  })

  it('shows a section heading’s weight once, as the value in use', () => {
    const design = home()
    design.style = { heading: { base: { weight: 700 } } }
    const heading = { element: 'heading', part: null, section: null, index: 0 } as const
    mount(heading as never, design)
    expect(screen.getAllByRole('radiogroup', { name: 'Weight' })).toHaveLength(1)
    expect(tiles('Weight').getByRole('radio', { name: 'Custom', checked: true })).toBeTruthy()
    expect((screen.getByLabelText('Custom weight') as HTMLInputElement).value).toBe('700')
    expect(screen.queryAllByLabelText('Weight', { selector: 'input' })).toEqual([])
  })

  it('folds a headline’s scale into its Size row', () => {
    const { box } = mount(headline)
    expect(screen.queryByRole('radiogroup', { name: 'Scale' })).toBeNull()
    fireEvent.click(tiles('Size').getByRole('radio', { name: 'Large' }))
    expect(box.design.brand.fonts.scale).toBe('large')
  })

  it('keeps the brand’s choices to every one of the kind; a one-off has the exact field only', () => {
    mount(cta)
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    expect(screen.queryByRole('radiogroup', { name: 'Corners' })).toBeNull()
    expect(screen.getByLabelText('Corners')).toBeTruthy()
  })

  it('keeps choices that are no one property’s in a Style section', () => {
    const nav = { element: 'navItem', part: null, section: null, index: 0 } as const
    mount(nav as never)
    expect(style().getByRole('radiogroup', { name: 'Menu' })).toBeTruthy()
    expect(style().queryByRole('radiogroup', { name: 'Text' })).toBeNull()
  })

  it('shows an exact value as every one’s, set here, and resets it to the theme, not to an older value', () => {
    // The brand match wrote the headline's size exactly; then it was changed here.
    const design = home()
    design.tune = { headline: { size: 48 } }
    const { box, view } = mount(headline, design)
    const size = () => screen.getByLabelText('Custom size') as HTMLInputElement
    expect(size().value).toBe('48')
    fireEvent.change(size(), { target: { value: '60' } })
    expect(box.design.tune).toEqual({ headline: { size: 60 } })
    expect(box.design.style).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: /^Reset to .* from brand$/ }))
    expect(box.design.tune).toBeUndefined()
    expect(box.design.style).toBeUndefined()
    // Back to the theme's scale, not the 48 the match once wrote.
    const scale = within(screen.getByRole('radiogroup', { name: 'Size' }))
    expect(scale.getByRole('radio', { name: 'Standard', checked: true })).toBeTruthy()
    fireEvent.click(scale.getByRole('radio', { name: 'Custom' }))
    expect(size().value).toBe('')
    expect(size().placeholder).not.toBe('48')
    expect(view.container.textContent).not.toContain('set exactly')
  })

  it('clears both layers an older design holds, so Reset never brings a value back', () => {
    const design = home()
    design.tune = { headline: { size: 48 } }
    design.style = { headline: { base: { size: 60 } } }
    const { box } = mount(headline, design)
    expect((screen.getByLabelText('Custom size') as HTMLInputElement).value).toBe('60')
    fireEvent.click(screen.getByRole('button', { name: /^Reset to .* from brand$/ }))
    expect(box.design.tune).toBeUndefined()
    expect(box.design.style).toBeUndefined()
  })

  it('shows every one’s exact value as where a one-off comes from', () => {
    const design = home()
    design.tune = { button: { radius: 14 } }
    const { view } = mount(cta, design)
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    expect((screen.getByLabelText('Corners') as HTMLInputElement).placeholder).toBe('14')
    expect(view.container.querySelector('[title="From every main button"]')).toBeTruthy()
  })

  it('resets every main button’s values, its exact ones too, from its menu', async () => {
    const design = home()
    design.tune = { button: { radius: 14, height: 40 }, card: { radius: 3 } }
    design.style = { button: { hover: { background: 'support' } } }
    const { box } = mount(cta, design)
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: /more actions/ }), { key: 'ArrowDown' })
    })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Reset every main button (3 values)' })
    )
    expect(box.design.tune).toEqual({ card: { radius: 3 } })
    expect(box.design.style).toBeUndefined()
  })

  it('reads a headline’s brand colour choice, and its font from the brand', () => {
    const design = home()
    design.brand.fonts.headlineColour = 'accent'
    mount(headline, design)
    expect(tiles('Colour').getByRole('radio', { name: 'Brand colour', checked: true })).toBeTruthy()
    expect(style().getByLabelText('Font')).toBeTruthy()
  })

  it('opened from Styles, changes every one of the kind only', () => {
    const { view } = mount(cta, home(), { shared: true })
    expect(line(view)).toBe('Changing every main button')
    expect(screen.queryByRole('button', { name: 'Just this one' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'This page' })).toBeNull()
  })

  it('opened from a block, starts at that block', () => {
    const { box, view } = mount(link, home(), { initialScope: 'block' })
    expect(line(view)).toBe('Changing this block’s links')
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '13' } })
    expect(box.design.pages.home.blocks[0]!.look).toEqual({
      style: { link: { base: { size: 13 } } },
    })
  })
})

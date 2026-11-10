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
import { resolveDesign } from '@/lib/shared/design/resolve'
import { ElementPanel } from '../element-panel'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

const cta = { element: 'button', part: 'hero.home.cta', section: 'hero', index: 0 } as const
const vote = { element: 'vote', part: null, section: 'block-abcdefgh', index: 1 } as const
const headline = { element: 'headline', part: null, section: null, index: 0 } as const
const link = { element: 'link', part: null, section: 'block-abcdefgh', index: 0 } as const
const postTitle = {
  element: 'body',
  part: 'block.abcdefgh.post-title',
  section: 'block-abcdefgh',
  index: 1,
} as const

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
  pick: typeof cta | typeof vote | typeof headline | typeof link | typeof postTitle,
  design = home(),
  extra: {
    reach?: { page: number; block: number | null }
    screen?: 'all' | 'phone'
    shared?: boolean
    initialScope?: 'block'
    drawn?: Parameters<typeof ElementPanel>[0]['drawn']
    onScreen?: (screen: 'all' | 'phone') => void
    onFonts?: (slot: 'heading' | 'headline') => void
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
      onScreen={extra.onScreen ?? (() => {})}
      onUp={() => {}}
      reach={extra.reach}
      shared={extra.shared}
      initialScope={extra.initialScope}
      drawn={extra.drawn}
      onFonts={extra.onFonts}
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
    // No kind tag mixed in with the scope.
    expect(view.container.querySelector('header')!.textContent).not.toContain('Element')
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

  it('opens simple: background, text colour and size, and corners; the rest under a closed More', () => {
    const { view } = mount(cta)
    const more = view.container.querySelector('details')!
    expect(more.open).toBe(false)
    const outside = [...view.container.querySelectorAll('[data-property-row]')].filter(
      (row) => !more.contains(row)
    )
    expect(outside.map((row) => row.querySelector('label')?.textContent)).toEqual([
      'Background',
      'Text colour',
      'Text size',
      'Corners',
    ])
    for (const label of ['Weight', 'Height', 'Padding across', 'Letter spacing', 'Opacity'])
      expect(more.contains(screen.getByLabelText(label))).toBe(true)
    for (const title of ['Text', 'Shape', 'Edge', 'Shadow'])
      expect(more.contains(screen.getByRole('heading', { name: title }))).toBe(true)
  })

  it('keeps More open for the visit once opened, and opens it where a value inside is set', () => {
    const first = mount(cta)
    const more = first.view.container.querySelector('details')!
    more.open = true
    fireEvent(more, new Event('toggle'))
    cleanup()
    const again = mount(cta)
    expect(again.view.container.querySelector('details')!.open).toBe(true)
    cleanup()
    window.sessionStorage.clear()
    const design = home()
    design.style = { button: { base: { paddingX: 20 } } }
    const set = mount(cta, design)
    expect(set.view.container.querySelector('details')!.open).toBe(true)
  })

  it('shows a measured value in whole pixels', () => {
    const view = render(
      <ElementPanel
        pick={cta}
        page="home"
        blockName="Hero"
        design={home()}
        update={() => {}}
        state="base"
        onState={() => {}}
        screen="all"
        onUp={() => {}}
        measure={(prop) => (prop === 'paddingX' ? 19.35 : undefined)}
      />
    )
    expect((screen.getByLabelText('Padding across') as HTMLInputElement).placeholder).toBe('19')
    expect(view.container.textContent).not.toContain('19.35')
  })

  it('shows the state as one chip, with a menu of the others and a mark on each that holds values', async () => {
    const design = home()
    design.style = { button: { hover: { background: 'support' } } }
    const { box } = mount(cta, design)
    expect(screen.queryByRole('radiogroup', { name: 'State' })).toBeNull()
    const chip = screen.getByRole('button', { name: /^State: Normal/ })
    await act(async () => {
      fireEvent.keyDown(chip, { key: 'ArrowDown' })
    })
    const hover = await screen.findByRole('menuitemradio', { name: /^Hover/ })
    expect(hover.textContent).toContain('Hover, set')
    expect(
      screen.getByRole('menuitemradio', { name: 'Normal' }).querySelector('[data-state-dot]')
    ).toBeNull()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Pressed' }))
    expect(box.state).toBe('active')
    expect(screen.getByRole('button', { name: /^State: Pressed/ })).toBeTruthy()
  })

  it('writes at the scope picked, shared at first, as one named undo step', () => {
    const { box } = mount(cta)
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '40' } })
    // Every main button's height is its exact value: one home, nothing in the style.
    expect(box.design.tune).toEqual({ button: { height: 40 } })
    expect(box.design.style).toBeUndefined()
    expect(box.labels.at(-1)).toBe('Call to action · Hero: height, everywhere')
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: '18' } })
    expect(
      findOverride(box.design, { scope: 'part', part: 'hero.home.cta', element: 'button' })?.style
    ).toEqual({ base: { size: 18 } })
    expect(box.labels.at(-1)).toBe('Call to action · Hero: size, just this one')
  })

  it('shows an unset value as what it has, says where from, and resets a set one to it', () => {
    const design = home()
    design.style = { button: { base: { radius: 6 } } }
    const { box, view } = mount(cta, design)
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    const corners = screen.getByLabelText('Corners') as HTMLInputElement
    expect(corners.value).toBe('')
    expect(corners.placeholder).toBe('6')
    expect(
      view.container.querySelector('[data-help][aria-label="From every main button"]')
    ).toBeTruthy()
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
    expect(view.container.querySelector('[data-help][aria-label="From brand"]')).toBeTruthy()
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

  it('shows the screen it edits as a chip under the scope line, not in the ⋯ menu', () => {
    const onScreen = vi.fn()
    mount(cta, home(), { onScreen })
    const chip = within(screen.getByRole('radiogroup', { name: 'Editing' }))
    expect(chip.getByRole('radio', { name: 'All screens' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(chip.getByRole('radio', { name: 'Phone' }))
    expect(onScreen).toHaveBeenCalledWith('phone')
    // Nothing set, so there is nothing else for the ⋯ menu to hold.
    expect(screen.queryByRole('button', { name: /more actions$/ })).toBeNull()
  })

  it('tints its scope block on a phone, with the chip on Phone and the way back', () => {
    const onScreen = vi.fn()
    const { view } = mount(cta, home(), { screen: 'phone', onScreen })
    expect(view.container.querySelector('[data-phone-mode]')).toBeTruthy()
    const chip = within(screen.getByRole('radiogroup', { name: 'Editing' }))
    expect(chip.getByRole('radio', { name: 'Phone' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(chip.getByRole('radio', { name: 'All screens' }))
    expect(onScreen).toHaveBeenCalledWith('all')
    expect(screen.queryByRole('heading', { name: 'Fill' })).toBeNull()
  })

  it('marks a row set for phones, and on a phone offers its all-screens value back', () => {
    const design = home()
    design.stylePhone = { headline: { base: { size: 31 } } }
    const sizeRow = () =>
      screen.getByText('Text size').closest('[data-property-row]')!.parentElement!
    const wide = mount(headline, design)
    expect(within(sizeRow()).getByText('Set for phones')).toBeTruthy()
    expect(wide.view.container.querySelectorAll('[data-phone-dot]')).toHaveLength(1)
    cleanup()
    const { box } = mount(headline, design, { screen: 'phone' })
    expect(within(sizeRow()).queryByRole('button', { name: /^Reset/ })).toBeNull()
    fireEvent.click(within(sizeRow()).getByRole('button', { name: 'Use all-screens value' }))
    expect(box.design.stylePhone?.headline?.base?.size).toBeUndefined()
    expect(box.labels.at(-1)).toBe('Headline: size, everywhere, phones')
  })
})

describe('a listed item, such as a post’s title', () => {
  it('names it as itself and counts what its change reaches, with no scope that misses it', () => {
    const { view, box } = mount(postTitle, home(), { reach: { page: 3, block: 3 } })
    expect(line(view)).toBe('Changing every post title in Top posts (3)')
    expect(view.container.textContent).not.toContain('body text')
    expect(
      screen.queryByRole('button', { name: /^(Just this one|This block|This page)/ })
    ).toBeNull()
    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: '18' } })
    expect(
      findOverride(box.design, {
        scope: 'part',
        part: 'block.abcdefgh.post-title',
        element: 'body',
      })?.style?.base?.size
    ).toBe(18)
    expect(box.labels.at(-1)).toBe('Post title · Top posts: size, every post title in Top posts')
  })

  it('never says (0) for what is picked, whatever the canvas counted', () => {
    const { view } = mount(vote, home(), { reach: { page: 0, block: 0 } })
    expect(line(view)).toBe('Changing every vote box')
    expect(screen.getByRole('button', { name: 'This block' })).toBeTruthy()
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

  it('shows a section heading’s weight once, as its exact value: the brand kit’s fonts hold the brand’s', () => {
    const design = home()
    design.style = { heading: { base: { weight: 700 } } }
    const heading = { element: 'heading', part: null, section: null, index: 0 } as const
    mount(heading as never, design)
    expect(screen.queryByRole('radiogroup', { name: 'Weight' })).toBeNull()
    expect(screen.getAllByLabelText('Weight', { selector: 'input' })).toHaveLength(1)
    expect((screen.getByLabelText('Weight', { selector: 'input' }) as HTMLInputElement).value).toBe(
      '700'
    )
  })

  it('folds the post cards’ shadow into their Shadow row while the look is Raised', () => {
    const design = home()
    design.layout.cards = 'bordered'
    const postCard = { element: 'postCard', part: null, section: null, index: 0 } as const
    const { box } = mount(postCard as never, design)
    expect(screen.queryByRole('radio', { name: 'Deep' })).toBeTruthy()
    expect(
      within(screen.getByRole('radiogroup', { name: 'Shadow' })).queryByRole('radio', {
        name: 'Custom',
      })
    ).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Raised' }))
    expect(
      tiles('Shadow')
        .getAllByRole('radio')
        .map((t) => t.textContent)
    ).toEqual(['Soft', 'Lifted', 'Floating', 'Deep', 'Custom'])
    fireEvent.click(tiles('Shadow').getByRole('radio', { name: 'Deep' }))
    expect(box.design.tune).toEqual({ card: { shadow: 'deep' } })
    expect(box.labels.at(-1)).toBe('Post card: shadow, everywhere')
  })

  it('keeps a headline’s Text size a number, as every text element has it, and its scale a Style choice', () => {
    const { box } = mount(headline)
    expect(screen.queryByRole('radiogroup', { name: 'Text size' })).toBeNull()
    expect((screen.getByLabelText('Text size') as HTMLInputElement).tagName).toBe('INPUT')
    fireEvent.click(style().getByRole('radio', { name: 'Large' }))
    expect(box.design.brand.fonts.scale).toBe('large')
  })

  it('gives a headline the Capitals control every text element has; As written and Capitals pick the brand’s', () => {
    const { box } = mount(headline)
    const capitals = tiles('Capitals')
    expect(capitals.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Aa',
      'AA',
      'aa',
      'Ab',
    ])
    fireEvent.click(capitals.getByRole('radio', { name: 'AA' }))
    expect(box.design.brand.fonts.headlineCase).toBe('upper')
    expect(box.design.tune?.headline?.case).toBeUndefined()
    fireEvent.click(tiles('Capitals').getByRole('radio', { name: 'aa' }))
    expect(box.design.tune?.headline?.case ?? box.design.style?.headline?.base?.case).toBe('lower')
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
    const size = () => screen.getByLabelText('Text size') as HTMLInputElement
    expect(size().value).toBe('48')
    fireEvent.change(size(), { target: { value: '60' } })
    expect(box.design.tune).toEqual({ headline: { size: 60 } })
    expect(box.design.style).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: /^Reset to .* from brand$/ }))
    expect(box.design.tune).toBeUndefined()
    expect(box.design.style).toBeUndefined()
    // Back to the theme's scale, not the 48 the match once wrote.
    expect(tiles('Scale').getByRole('radio', { name: 'Standard', checked: true })).toBeTruthy()
    expect(size().value).toBe('')
    expect(size().placeholder).not.toBe('48')
    expect(view.container.textContent).not.toContain('set exactly')
  })

  it('clears both layers an older design holds, so Reset never brings a value back', () => {
    const design = home()
    design.tune = { headline: { size: 48 } }
    design.style = { headline: { base: { size: 60 } } }
    const { box } = mount(headline, design)
    expect((screen.getByLabelText('Text size') as HTMLInputElement).value).toBe('60')
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
    expect(
      view.container.querySelector('[data-help][aria-label="From every main button"]')
    ).toBeTruthy()
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

  it('reads a headline’s brand colour choice, and its font from the brand kit, its one writer', () => {
    const design = home()
    design.brand.fonts.headlineColour = 'accent'
    const onFonts = vi.fn()
    const { box } = mount(headline, design, { onFonts })
    // The colour chip every text element has, on the brand's choice.
    expect(screen.queryByRole('radiogroup', { name: 'Text colour' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Text colour: / })).toBeTruthy()
    // A summary of the brand's font, which opens the brand kit's fonts at the headline's slot.
    const font = style().getByRole('button', { name: /^Font: / })
    expect(style().queryByRole('combobox', { name: 'Font' })).toBeNull()
    fireEvent.click(font)
    expect(onFonts).toHaveBeenCalledExactlyOnceWith('headline')
    expect(box.labels).toEqual([])
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
    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: '13' } })
    expect(box.design.pages.home.blocks[0]!.look).toEqual({
      style: { link: { base: { size: 13 } } },
    })
  })
})

describe('what the canvas draws, where it is not what a row stores', () => {
  const styled = () => {
    const design = home()
    design.style = { headline: { base: { size: 56, color: '#fefefe' } } }
    return design
  }
  const note = (view: ReturnType<typeof render>, label: string) =>
    view.container.querySelector(`[data-in-use="${label}"]`)

  it('says a headline’s size is its widest, and the size this phone draws, with Use this', () => {
    const { box, view } = mount(headline, styled(), {
      screen: 'phone',
      drawn: { values: { size: 30.8 }, size: 'phone', dark: false },
    })
    const size = note(view, 'Text size')!
    expect(size.textContent).toContain('56 max · 31 on this phone')
    fireEvent.click(within(size as HTMLElement).getByRole('button', { name: 'Use this' }))
    expect(box.labels.at(-1)).toBe('Headline: size, everywhere, phones')
    expect(box.design.stylePhone?.headline?.base?.size).toBe(31)
  })

  it('says a text colour is moved so it reads, and Use this stores the colour in use', () => {
    const { box, view } = mount(headline, styled(), {
      drawn: { values: { color: 'rgb(143, 143, 143)' }, size: 'desktop', dark: false },
    })
    const colour = note(view, 'Text colour')!
    expect(colour.textContent).toContain('Shown as #8F8F8F so it reads')
    fireEvent.click(within(colour as HTMLElement).getByRole('button', { name: 'Use this' }))
    expect(box.design.style?.headline?.base?.color).toBe('#8f8f8f')
  })

  it('says nothing while the canvas draws what is stored, or before it is read', () => {
    const { view } = mount(headline, styled(), {
      drawn: { values: { size: 56, color: 'rgb(254, 254, 254)' }, size: 'desktop', dark: false },
    })
    expect(view.container.querySelector('[data-in-use]')).toBeNull()
    cleanup()
    const before = mount(headline, styled())
    expect(before.view.container.querySelector('[data-in-use]')).toBeNull()
  })

  it('compares a colour on a dark canvas with dark’s, and Use this sets dark mode’s own', () => {
    const inked = () => {
      const design = home()
      design.style = { headline: { base: { color: 'ink' } } }
      return design
    }
    const rgb = (hex: string) =>
      `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`
    const { light, dark } = resolveDesign(inked())
    expect(light!.foreground).not.toBe(dark!.foreground)
    // Drawn as dark draws the ink: nothing to say.
    const same = mount(headline, inked(), {
      drawn: { values: { color: rgb(dark!.foreground!) }, size: 'desktop', dark: true },
    })
    expect(note(same.view, 'Text colour')).toBeNull()
    cleanup()
    // Light's ink is not what dark draws.
    const lit = mount(headline, inked(), {
      drawn: { values: { color: rgb(light!.foreground!) }, size: 'desktop', dark: true },
    })
    expect(note(lit.view, 'Text colour')).not.toBeNull()
    cleanup()
    const { box, view } = mount(headline, inked(), {
      drawn: { values: { color: 'rgb(30, 30, 30)' }, size: 'desktop', dark: true },
    })
    const colour = note(view, 'Text colour')!
    expect(colour.textContent).toContain('Shown as #1E1E1E so it reads')
    fireEvent.click(within(colour as HTMLElement).getByRole('button', { name: 'Use this' }))
    expect(box.design.styleDark?.headline?.base?.color).toBe('#1e1e1e')
    expect(box.design.style?.headline?.base?.color).toBe('ink')
  })
})

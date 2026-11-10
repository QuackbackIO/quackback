// @vitest-environment happy-dom
/**
 * The properties frame every panel shares: a breadcrumb that picks the
 * parent, a scope line that starts shared and counts only what it can,
 * compact rows that say where an unset value comes from and what Reset goes
 * back to, optional sections added with "+", numbers that drag and step, and
 * brand colours that stay linked by name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  PropertiesPanel,
  PropertyDrawnTiles,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  tileColumns,
} from '../properties/properties-panel'
import { ReachNote, ScopeLine } from '../properties/scope-line'
import { SCOPE_NAMES } from '@/lib/shared/design/override-cascade'
import { ScrubNumber } from '../properties/scrub-number'
import { CanvasModeContext } from '../properties/canvas-mode'
import { FontField, TokenField } from '../properties/token-field'
import type { ColourToken, FontToken } from '../properties/tokens'
import { COLOUR_NAMES, WORDS, resetTo } from '../properties/words'

/** A target at least 24px tall, as small text links and buttons are given. */
const at24 = (el: Element) => expect(el.className).toMatch(/(^|\s)(min-h-6|size-6|min-h-7)(\s|$)/)

afterEach(cleanup)

describe('the panel frame', () => {
  it('makes each crumb but the last a button that picks that parent', () => {
    const up = vi.fn()
    render(
      <PropertiesPanel
        crumbs={[{ label: 'Home' }, { label: 'Top posts', onSelect: up }, { label: 'Main button' }]}
        title="Main button"
      >
        <p>rows</p>
      </PropertiesPanel>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Top posts' }))
    expect(up).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Main button' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Main button' })).toBeTruthy()
    // No kind tag beside the title: what it is shows in the trail.
    expect(screen.queryByText('Element')).toBeNull()
  })

  it('shows the overrides footer only when something is set differently, each with Reset', () => {
    const reset = vi.fn()
    const view = render(
      <PropertiesPanel crumbs={[]} title="Main button">
        <p>rows</p>
      </PropertiesPanel>
    )
    expect(view.container.textContent).not.toContain('Set differently')
    view.rerender(
      <PropertiesPanel
        crumbs={[]}
        title="Main button"
        overrides={[
          { key: 'a', label: 'Changelog page', detail: 'corners', onReset: reset },
          { key: 'b', label: 'Call to action · Hero', onReset: () => {} },
        ]}
      >
        <p>rows</p>
      </PropertiesPanel>
    )
    expect(view.container.textContent).toContain('Set differently in 2 places')
    expect(view.container.textContent).toContain('Changelog page: corners')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Changelog page' }))
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('sections', () => {
  it('shows an optional section as its title and "+" until added, then "−" removes it', () => {
    const add = vi.fn()
    const view = render(
      <PropertySection title="Edge" onAdd={add} added={false} onRemove={() => {}}>
        <p>edge rows</p>
      </PropertySection>
    )
    expect(view.container.textContent).not.toContain('edge rows')
    expect(screen.queryByRole('button', { name: 'Remove edge' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add edge' }))
    expect(add).toHaveBeenCalledOnce()
    view.rerender(
      <PropertySection title="Edge" onAdd={add} added onRemove={() => {}}>
        <p>edge rows</p>
      </PropertySection>
    )
    expect(view.container.textContent).toContain('edge rows')
    expect(screen.getByRole('button', { name: 'Remove edge' })).toBeTruthy()
  })

  it('keeps the rarely used rows under a closed More', () => {
    const view = render(
      <PropertySection title="Text" more={<p>rare</p>}>
        <p>common</p>
      </PropertySection>
    )
    const more = view.container.querySelector('details')!
    expect(more.open).toBe(false)
    expect(more.textContent).toContain('rare')
    expect(more.textContent).not.toContain('common')
  })
})

describe('a property row', () => {
  it('says where an unset value comes from, with no dot and no Reset', () => {
    const view = render(
      <PropertyRow label="Corners" source="From brand">
        <span>8</span>
      </PropertyRow>
    )
    expect(view.container.querySelector('[data-set-dot]')).toBeNull()
    expect(screen.getByRole('button', { name: 'From brand' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull()
  })

  it('marks a value set here and resets it to the value it names', () => {
    const reset = vi.fn()
    const view = render(
      <PropertyRow label="Corners" set resetLabel={resetTo('8 px', 'From brand')} onReset={reset}>
        <span>12</span>
      </PropertyRow>
    )
    expect(view.container.querySelector('[data-set-dot]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to 8 px from brand' }))
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('a row of tiles', () => {
  const LONG = [
    ['tabs', 'Tabs'],
    ['underline', 'Underline'],
    ['pills', 'Pills'],
    ['comfortable', 'Comfortable'],
    ['help', 'Help Center'],
    ['logo', 'Logo colours'],
  ] as const

  it('lies in an even grid when the names do not fit one row, so no tile is left alone', () => {
    render(<PropertyTiles label="Style" value="tabs" options={LONG} onChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Style' })
    expect(group.className).toContain('grid-cols-2')
    expect(group.className).not.toContain('flex-wrap')
    for (const [, name] of LONG) {
      const tile = screen.getByRole('radio', { name })
      expect(tile.textContent).toBe(name)
      // Never cut off: a long name wraps between words inside its tile.
      expect(tile.className).not.toMatch(/truncate|break-words|whitespace-nowrap/)
    }
  })

  it('shares one row, each tile as wide as its name, when the names fit', () => {
    render(
      <PropertyTiles label="Few" value="tabs" options={LONG.slice(0, 3)} onChange={() => {}} />
    )
    const group = screen.getByRole('radiogroup', { name: 'Few' })
    expect(group.className).toContain('flex')
    expect(group.className).not.toMatch(/grid|flex-wrap/)
    expect(screen.getByRole('radio', { name: 'Tabs' }).className).toContain('whitespace-nowrap')
  })

  it('outlines the picked tile rather than filling it, so dark mode shows no white block', () => {
    render(
      <PropertyTiles label="Few" value="tabs" options={LONG.slice(0, 2)} onChange={() => {}} />
    )
    const picked = screen.getByRole('radio', { name: 'Tabs' })
    expect(picked.className).toContain('ring-foreground')
    expect(picked.className).toContain('forced-colors:outline')
    expect(picked.className).not.toMatch(/bg-foreground|text-background/)
  })
})

describe('tileColumns', () => {
  it('keeps short names on one row', () => {
    expect(tileColumns(['Composer', 'Button', 'None'])).toBe(0)
    expect(tileColumns(['Short', 'Roomy', 'Tall'])).toBe(0)
  })
  it('never orphans a tile: four that do not fit go two by two', () => {
    expect(tileColumns(['Home', 'Feedback', 'Roadmap', 'Changelog'])).toBe(2)
    expect(tileColumns(['Standard', 'Large', 'Display', 'Custom'])).toBe(2)
  })
  it('keeps three that do not fit as three equal columns', () => {
    expect(tileColumns(['As written', 'All capitals', 'Custom'])).toBe(3)
  })
  it('takes five or more three to a row when they fit, else two', () => {
    expect(tileColumns(['Aa', 'AA', 'aa', 'Ab', 'Abc', 'Def'])).toBe(0)
    expect(tileColumns(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'])).toBe(3)
    expect(tileColumns(['Comfortable', 'Help Center', 'Logo colours', 'Tabs', 'Pills'])).toBe(2)
  })
})

describe('tiles from the keyboard', () => {
  const OPTIONS = [
    ['a', 'One'],
    ['b', 'Two'],
    ['c', 'Three'],
  ] as const
  const stops = () =>
    screen.getAllByRole('radio').map((radio) => (radio.tabIndex === 0 ? radio.textContent : null))

  it('is one Tab stop, the picked tile, and the arrows move to the next and pick it', () => {
    const pick = vi.fn()
    const { rerender } = render(
      <PropertyTiles label="Count" value="b" options={OPTIONS} onChange={pick} />
    )
    expect(stops().filter(Boolean)).toEqual(['Two'])
    const two = screen.getByRole('radio', { name: 'Two' })
    act(() => two.focus())
    fireEvent.keyDown(two, { key: 'ArrowRight' })
    expect(pick).toHaveBeenLastCalledWith('c')
    expect(document.activeElement?.textContent).toBe('Three')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(pick).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(pick).toHaveBeenLastCalledWith('c')
    // Unset: the tile it has from wider up takes Tab, else the first.
    rerender(
      <PropertyTiles
        label="Count"
        value={undefined}
        inherited="c"
        options={OPTIONS}
        onChange={pick}
      />
    )
    expect(stops().filter(Boolean)).toEqual(['Three'])
    rerender(<PropertyTiles label="Count" value={undefined} options={OPTIONS} onChange={pick} />)
    expect(stops().filter(Boolean)).toEqual(['One'])
  })

  it('moves the same way through drawn tiles', () => {
    const pick = vi.fn()
    render(
      <PropertyDrawnTiles
        label="Look"
        value="a"
        options={OPTIONS.map(([v, n]) => [v, n, <span key={v} />] as const)}
        onChange={pick}
      />
    )
    const one = screen.getByRole('radio', { name: 'One' })
    expect(one.tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'Two' }).tabIndex).toBe(-1)
    act(() => one.focus())
    fireEvent.keyDown(one, { key: 'ArrowLeft' })
    expect(pick).toHaveBeenLastCalledWith('c')
  })
})

describe('drawn tiles', () => {
  it('names each drawing in full and takes the one picked', () => {
    const pick = vi.fn()
    render(
      <PropertyDrawnTiles
        label="Look"
        value="plain"
        columns={4}
        options={[
          ['plain', 'Plain', <i key="p" />],
          ['brand-waves', 'Bold waves', <i key="w" />],
        ]}
        onChange={pick}
      />
    )
    const group = screen.getByRole('radiogroup', { name: 'Look' })
    expect(group.className).toContain('grid-cols-4')
    expect(screen.getByRole('radio', { name: 'Plain' }).getAttribute('aria-checked')).toBe('true')
    const waves = screen.getByRole('radio', { name: 'Bold waves' })
    expect(waves.getAttribute('aria-checked')).toBe('false')
    expect(waves.textContent).toBe('Bold waves')
    expect(waves.innerHTML).not.toContain('truncate')
    fireEvent.click(waves)
    expect(pick).toHaveBeenCalledWith('brand-waves')
  })
})

describe('hover help', () => {
  it('keeps a row’s and a section’s advice behind an ⓘ, said on hover', async () => {
    render(
      <PropertySection title="Image" help="A photo works best.">
        <PropertyRow label="Alt text" help="What the image shows">
          <span>x</span>
        </PropertyRow>
      </PropertySection>
    )
    // Each ⓘ takes focus, and says its advice in a tooltip, never a title.
    const help = screen.getByRole('button', { name: 'A photo works best.' })
    expect(help.getAttribute('title')).toBeNull()
    expect(screen.getByRole('button', { name: 'What the image shows' })).toBeTruthy()
    expect(screen.queryByText('What the image shows')).toBeNull()
    act(() => help.focus())
    expect(await screen.findByText('A photo works best.')).toBeTruthy()
  })
})

describe('the scope line', () => {
  const line = (value: 'everywhere' | 'part' | 'page', onChange = vi.fn()) => (
    <ScopeLine
      one="Main button"
      widest={{ id: 'everywhere', count: 3, countNote: 'on this page' }}
      narrower={[
        {
          id: 'part',
          link: 'Just this one',
          phrase: 'just this one',
          detail: 'Call to action · Hero',
        },
        { id: 'page', link: 'This page', phrase: 'main buttons on this page', count: 3 },
      ]}
      value={value}
      onChange={onChange}
    />
  )

  it('starts shared, counts what it can and says what the count covers', () => {
    const onChange = vi.fn()
    const view = render(line('everywhere', onChange))
    expect(view.container.querySelector('p')!.textContent).toBe(
      'Changing every main button (3 on this page)'
    )
    fireEvent.click(screen.getByRole('button', { name: 'This page (3)' }))
    expect(onChange).toHaveBeenLastCalledWith('page')
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    expect(onChange).toHaveBeenLastCalledWith('part')
  })

  it('says a one-off is one, with a way back to every one', () => {
    const onChange = vi.fn()
    const view = render(line('part', onChange))
    expect(view.container.querySelector('p')!.textContent).toBe(
      'Changing just this one: Call to action · Hero'
    )
    expect(screen.queryByRole('button', { name: 'This page (3)' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to every main button' }))
    expect(onChange).toHaveBeenLastCalledWith('everywhere')
  })

  it('shows no number where none is counted', () => {
    const view = render(
      <ScopeLine
        one="Heading"
        widest={{ id: 'all' }}
        narrower={[]}
        value="all"
        onChange={() => {}}
      />
    )
    expect(view.container.textContent).toBe('Changing every heading')
  })
})

describe('a number you drag', () => {
  function mount(value?: number) {
    const changes: Array<number | undefined> = []
    render(
      <ScrubNumber
        id="corners"
        label="Corners"
        value={value}
        inherited={8}
        min={0}
        max={40}
        unit="px"
        onChange={(v) => changes.push(v)}
      />
    )
    return changes
  }

  it('shows the inherited value muted while unset, and steps from it with the arrows, ten with Shift', () => {
    const changes = mount()
    const field = screen.getByLabelText('Corners') as HTMLInputElement
    expect(field.value).toBe('')
    expect(field.placeholder).toBe('8')
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(changes.at(-1)).toBe(9)
    fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true })
    expect(changes.at(-1)).toBe(19)
    fireEvent.keyDown(field, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(field, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(field, { key: 'ArrowDown', shiftKey: true })
    expect(changes.at(-1)).toBe(0)
  })

  it('changes as it is dragged left or right, within its bounds', () => {
    const changes = mount(10)
    const handle = screen.getByRole('slider', { name: 'Drag to change corners' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 112, pointerId: 1 })
    expect(changes.at(-1)).toBe(13)
    fireEvent.pointerMove(handle, { clientX: 60, pointerId: 1 })
    expect(changes.at(-1)).toBe(0)
    fireEvent.pointerUp(handle, { pointerId: 1 })
    const before = changes.length
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 })
    expect(changes.length).toBe(before)
  })

  it('commits what is typed as a number field does, not while it is out of bounds', () => {
    const changes = mount(10)
    const field = screen.getByLabelText('Corners')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '4' } })
    fireEvent.change(field, { target: { value: '45' } })
    expect(changes).toEqual([4])
    fireEvent.blur(field)
    expect(changes.at(-1)).toBe(40)
  })
})

const TOKENS: ColourToken[] = [
  { id: 'accent', name: COLOUR_NAMES.accent, light: '#b0123a', dark: '#f0507a' },
  { id: 'ink', name: COLOUR_NAMES.ink, light: '#111111', dark: '#eeeeee' },
  { id: 'page', name: COLOUR_NAMES.page, light: '#ffffff', dark: '#000000' },
]

describe('a brand colour field', () => {
  it('shows a linked colour as its role, and stores the role when a brand swatch is picked', async () => {
    const onChange = vi.fn()
    render(
      <TokenField id="bg" label="Background" value="ink" tokens={TOKENS} onChange={onChange} />
    )
    const chip = screen.getByRole('button', { name: 'Background: Text' })
    expect(chip.getAttribute('data-token-state')).toBe('linked')
    await act(async () => fireEvent.click(chip))
    fireEvent.click(await screen.findByRole('button', { name: 'Brand colour' }))
    expect(onChange).toHaveBeenLastCalledWith('accent')
  })

  it('shows an inherited colour muted, by its role', () => {
    render(
      <TokenField
        id="bg"
        label="Background"
        value={undefined}
        inherited="accent"
        tokens={TOKENS}
        onChange={() => {}}
      />
    )
    const chip = screen.getByRole('button', { name: 'Background: Brand colour' })
    expect(chip.className).toContain('text-muted-foreground')
  })

  it('shows a hex as detached, with a way back to the role it matches', () => {
    const onChange = vi.fn()
    render(
      <TokenField id="bg" label="Background" value="#b0123a" tokens={TOKENS} onChange={onChange} />
    )
    expect(
      screen.getByRole('button', { name: 'Background: #b0123a' }).getAttribute('data-token-state')
    ).toBe('detached')
    const back = screen.getByRole('button', { name: 'Link to Brand colour' })
    at24(back)
    fireEvent.click(back)
    expect(onChange).toHaveBeenLastCalledWith('accent')
  })

  it('draws a half swatch when dark mode differs, and sets dark apart from light', async () => {
    const light = vi.fn()
    const dark = vi.fn()
    const view = render(
      <TokenField
        id="bg"
        label="Background"
        value="accent"
        tokens={TOKENS}
        onChange={light}
        dark={{ value: 'ink', onChange: dark }}
      />
    )
    expect(view.container.querySelector('[data-swatch=half]')).toBeTruthy()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Background: Brand colour' }))
    )
    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page' }))
    expect(dark).toHaveBeenLastCalledWith('page')
    expect(light).not.toHaveBeenCalled()
  })

  it('draws the dark half in the dark colour of the role dark mode uses', () => {
    const view = render(
      <TokenField
        id="bg"
        label="Background"
        value="accent"
        tokens={TOKENS}
        onChange={() => {}}
        dark={{ value: 'ink', onChange: () => {} }}
      />
    )
    const swatch = view.container.querySelector<HTMLElement>('[data-swatch=half]')!
    expect(swatch.style.background).toContain('#eeeeee')
    expect(swatch.style.background).not.toContain('#111111')
  })

  it('opens on the mode the canvas shows', async () => {
    render(
      <CanvasModeContext.Provider value="dark">
        <TokenField
          id="bg"
          label="Background"
          value="accent"
          tokens={TOKENS}
          onChange={() => {}}
          dark={{ value: undefined, onChange: () => {} }}
        />
      </CanvasModeContext.Provider>
    )
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Background: Brand colour' }))
    )
    expect((await screen.findByRole('radio', { name: 'Dark' })).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('draws a whole swatch when dark mode follows light', () => {
    const view = render(
      <TokenField
        id="bg"
        label="Background"
        value="accent"
        tokens={TOKENS}
        onChange={() => {}}
        dark={{ value: undefined, onChange: () => {} }}
      />
    )
    expect(view.container.querySelector('[data-swatch=half]')).toBeNull()
  })
})

const FONTS: FontToken[] = [
  { id: 'heading', name: 'Heading font', face: 'Fraunces', stack: 'serif' },
  { id: 'headline', name: 'Headline font', face: 'Fraunces', stack: 'serif' },
  { id: 'body', name: 'Body font', face: 'Inter', stack: 'sans-serif' },
]

describe('a brand font field', () => {
  it('shows the slot and its face, and stores the slot when another is picked', async () => {
    const onChange = vi.fn()
    render(
      <FontField
        id="font"
        label="Font"
        value={undefined}
        inherited="heading"
        slots={FONTS}
        onChange={onChange}
      />
    )
    const chip = screen.getByRole('button', { name: 'Font: Heading font, Fraunces' })
    expect(chip.getAttribute('data-token-state')).toBe('linked')
    await act(async () => fireEvent.click(chip))
    fireEvent.click(await screen.findByRole('button', { name: /Body font/ }))
    expect(onChange).toHaveBeenLastCalledWith('body')
  })
})

describe('one ladder of scope words', () => {
  it('names each scope from the one table, for the panels and the undo steps alike', () => {
    expect(SCOPE_NAMES).toEqual({
      part: WORDS.justThisOne,
      block: WORDS.thisBlock,
      page: WORDS.thisPage,
      everywhere: WORDS.everywhere,
    })
  })

  it('says a single reach as a plain sentence, with no ladder', () => {
    const view = render(<ReachNote phrase="the header" count={5} countNote="pages" />)
    expect(view.container.textContent).toBe('Applies to the header (5 pages)')
    expect(view.container.querySelector('[data-scope-line]')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('a row’s label', () => {
  it('wraps between words when longer than its column, never inside a word, never cut off', () => {
    render(
      <PropertyRow label="Logo colours" source="Read from your logo">
        <span />
      </PropertyRow>
    )
    const label = screen.getByText('Logo colours')
    expect(label.className).not.toMatch(
      /truncate|text-ellipsis|whitespace-nowrap|break-words|break-all/
    )
  })

  it('keeps the end slot on every row, so set and unset rows end at one edge', () => {
    render(
      <>
        <PropertyRow label="Unset">
          <span />
        </PropertyRow>
        <PropertyRow label="Set" set onReset={() => {}}>
          <span />
        </PropertyRow>
      </>
    )
    const ends = document.querySelectorAll('[data-row-end]')
    expect(ends).toHaveLength(2)
    expect(ends[0].className).toBe(ends[1].className)
    expect(ends[1].querySelector('button[aria-label="Reset set"]')).not.toBeNull()
  })
})

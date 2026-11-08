// @vitest-environment happy-dom
/**
 * The picked block's own panel, mounted from the registry with the
 * workspace's real sources: Top posts draws from the boards visitors can see,
 * a change reaches the draft named for the block and the setting, and a
 * page section writes the page's choices.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EDIT_ON_CANVAS } from '../words/edit-on-canvas'
import { newBlock } from '@/lib/shared/design/home'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const MOBILE = 'board_01h455vb4pex5vsknk084sn02q'

vi.mock('../use-block-sources', () => ({
  useBlockSources: () => ({ boards: [[MOBILE, 'Mobile']], roadmaps: [], categories: [] }),
}))
vi.mock('@/components/admin/settings/branding/welcome-body-editor', () => ({
  WelcomeBodyEditor: () => null,
}))

const { PickedBlock } = await import('../picked-block')

afterEach(cleanup)

function show(
  selection: string,
  design = defaultDesign(),
  phone = false,
  checks: string[] = [],
  onPhone?: (phone: boolean) => void
) {
  const seen = { design, labels: [] as Array<string | undefined> }
  const say = vi.fn()
  const onSelect = vi.fn()
  const props = (now: PortalDesign) => ({
    selection: selection as never,
    design: now,
    locale: 'en',
    phone,
    onPhone,
    checks,
    onSelect,
    say,
    update: (change: (draft: PortalDesign) => void, label?: string) => {
      const next = structuredClone(seen.design)
      change(next)
      seen.design = next
      seen.labels.push(label)
      view.rerender(<PickedBlock {...props(next)} />)
    },
  })
  const view = render(<PickedBlock {...props(design)} />)
  return { seen, say, onSelect }
}

/** The words the canvas was asked to edit where they sit. */
function askedToEdit() {
  const asked: string[] = []
  const hear = (event: Event) => asked.push((event as CustomEvent<string>).detail)
  window.addEventListener(EDIT_ON_CANVAS, hear)
  return { asked, stop: () => window.removeEventListener(EDIT_ON_CANVAS, hear) }
}

/** Opens a dropdown menu from the keyboard, as Radix takes it in a test. */
async function openMenu(trigger: HTMLElement) {
  act(() => trigger.focus())
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

const rowOf = (label: string) =>
  screen
    .getAllByText(label, { selector: 'label' })
    .map((each) => each.closest('[data-property-row]') as HTMLElement)[0]!

function home(): PortalDesign {
  const design = defaultDesign()
  design.pages.home.blocks = [
    { ...newBlock('welcome'), id: 'welcome01' },
    { ...newBlock('ideas'), id: 'ideas0001' },
  ]
  return design
}

describe('the picked block’s panel', () => {
  it('lets Top posts draw from a public board', () => {
    const { seen } = show('block-ideas0001', home())
    expect(screen.getByRole('heading', { name: 'Top posts' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mobile' }))
    const ideas = seen.design.pages.home.blocks[1] as { boardIds?: string[] }
    expect(ideas.boardIds).toEqual([MOBILE])
    expect(seen.labels).toEqual(['Top posts: From'])
  })

  it('names a change for the block and the setting, for undo', () => {
    const { seen, say } = show('block-ideas0001', home())
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'How many' })).getByRole('radio', {
        name: '10',
      })
    )
    expect(say.mock.calls).toEqual([])
    expect((seen.design.pages.home.blocks[1] as { count: number }).count).toBe(10)
    expect(seen.labels).toEqual(['Top posts: How many'])
  })

  it('writes a page section’s choices into its page', () => {
    const { seen } = show('board')
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /Layout|Board/ })).getByRole('radio', {
        name: 'List',
      })
    )
    expect(seen.design.pages.roadmap?.board).toBe('list')
  })

  it('says on a phone that Home’s blocks stack in reading order, in place of its layout', () => {
    show('block-ideas0001', home(), true)
    const layout = screen.getByRole('region', { name: 'Layout' })
    expect(within(layout).getByText('Stacks in reading order')).toBeTruthy()
    expect(within(layout).queryByRole('radiogroup', { name: 'Width' })).toBeNull()
  })

  it('says nothing of phones on a wider canvas', () => {
    show('block-ideas0001', home())
    expect(screen.queryByText(/Stacks in reading order/)).toBeNull()
  })

  it('says in its panel what the checks found in the block', () => {
    show('block-ideas0001', home(), false, ['Top posts and Status share a heading.'])
    expect(screen.getByText('Top posts and Status share a heading.')).toBeTruthy()
  })
})

describe('a Home block’s words', () => {
  it('show the heading the page draws while it has none, muted, with no dot', () => {
    show('block-ideas0001', home())
    const row = rowOf('Heading')
    expect(within(row).getByText('Trending posts').className).toContain('text-muted-foreground')
    expect(row.hasAttribute('data-set')).toBe(false)
  })

  it('are never retyped in the panel: Edit opens them on the canvas', () => {
    show('block-ideas0001', home())
    expect(within(screen.getByRole('region', { name: 'Words' })).queryByRole('textbox')).toBeNull()
    const ears = askedToEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Edit heading' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }))
    ears.stop()
    expect(ears.asked).toEqual(['block-ideas0001.heading', 'block-ideas0001.link'])
  })

  it('show its own heading with a dot, and Reset gives the usual one back', () => {
    const design = home()
    ;(design.pages.home.blocks[1] as { heading?: Record<string, string> }).heading = {
      en: 'Loved ideas',
    }
    const { seen } = show('block-ideas0001', design)
    const row = rowOf('Heading')
    expect(within(row).getByText('Loved ideas')).toBeTruthy()
    expect(row.hasAttribute('data-set')).toBe(true)
    fireEvent.click(within(row).getByRole('button', { name: 'Reset to “Trending posts”' }))
    expect((seen.design.pages.home.blocks[1] as { heading?: unknown }).heading).toBeUndefined()
  })

  it('offer to add a heading to a block that draws none, and open it on the canvas', () => {
    const { seen } = show('block-welcome01', home())
    const row = rowOf('Heading')
    expect(within(row).getByText('None')).toBeTruthy()
    const ears = askedToEdit()
    fireEvent.click(within(row).getByRole('button', { name: 'Add heading' }))
    ears.stop()
    expect((seen.design.pages.home.blocks[0] as { heading?: unknown }).heading).toEqual({
      en: 'Welcome',
    })
    expect(ears.asked).toEqual(['block-welcome01.heading'])
  })

  it('show a Welcome message as it reads, opened on the canvas', () => {
    show('block-welcome01', home())
    const row = rowOf('Message')
    expect(row.querySelector('[data-words-row]')?.textContent).not.toBe('')
    const ears = askedToEdit()
    fireEvent.click(within(row).getByRole('button', { name: 'Edit message' }))
    ears.stop()
    expect(ears.asked).toEqual(['block-welcome01.body'])
  })

  it('keep the full editor for a message holding images or tables, in a dialog', () => {
    const design = home()
    ;(design.pages.home.blocks[0] as { body: unknown }).body = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://example.com/a.png' } }],
    }
    show('block-welcome01', design)
    const row = rowOf('Message')
    expect(within(row).getByText('Has images or tables')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Edit here' }))
    expect(screen.getByRole('dialog', { name: 'Message' })).toBeTruthy()
  })
})

describe('a Home block’s layout', () => {
  it('offers widths no narrower than the block can be', () => {
    const design = home()
    design.pages.home.blocks.push({ ...newBlock('roadmap', { y: 2 }), id: 'roadmap01' })
    show('block-roadmap01', design)
    const width = screen.getByRole('radiogroup', { name: 'Width' })
    expect(
      within(width)
        .getAllByRole('radio')
        .map((tile) => tile.textContent)
    ).toEqual(['½', '⅔', 'Full'])
  })

  it('resizes and moves the block on the grid, named for undo and said aloud', () => {
    const design = home()
    design.pages.home.blocks[1]!.grid = { x: 0, y: 1, w: 6, h: 1 }
    const { seen, say } = show('block-ideas0001', design)
    const width = screen.getByRole('radiogroup', { name: 'Width' })
    expect(within(width).getByRole('radio', { name: '½' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(within(width).getByRole('radio', { name: '⅓' }))
    expect(seen.design.pages.home.blocks[1]!.grid.w).toBe(4)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Column' }), {
      target: { value: '5' },
    })
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Column' }))
    expect(seen.design.pages.home.blocks.find((b) => b.id === 'ideas0001')!.grid.x).toBe(4)
    expect(seen.labels).toEqual(['Top posts: width', 'Top posts: column'])
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/^Top posts resized to 4 columns/))
  })
})

describe('a Home block’s look', () => {
  const three = () => {
    const design = home()
    design.pages.home.blocks.push({ ...newBlock('status', { y: 2 }), id: 'status001' })
    return design
  }

  it('is shared by every Home block by default, and says how many', () => {
    const { seen } = show('block-ideas0001', three())
    expect(screen.getByText('every Home block')).toBeTruthy()
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Background' })).getByRole('radio', {
        name: 'Tint',
      })
    )
    expect(seen.design.pages.home.blocks.map((b) => b.look?.tone)).toEqual(['tint', 'tint', 'tint'])
    expect(seen.labels).toEqual(['Top posts: background, every Home block'])
  })

  it('changes just this one once set apart, and lists the others as set differently', () => {
    const { seen } = show('block-ideas0001', three())
    fireEvent.click(screen.getByRole('button', { name: 'Just this one' }))
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Align' })).getByRole('radio', {
        name: 'Centre',
      })
    )
    expect(seen.design.pages.home.blocks.map((b) => b.look?.align)).toEqual([
      undefined,
      'centre',
      undefined,
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Back to every home block' }))
    expect(screen.getByText('Set differently in 2 places')).toBeTruthy()
  })

  it('offers a colour only for a tint or a brand background', () => {
    show('block-ideas0001', three())
    expect(screen.queryByText('Colour', { selector: 'label' })).toBeNull()
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Background' })).getByRole('radio', {
        name: 'Brand',
      })
    )
    expect(screen.getByText('Colour', { selector: 'label' })).toBeTruthy()
  })

  it('offers only the elements the block draws, and opens one in the element panel', async () => {
    show('block-status001', three())
    const menu = await openMenu(screen.getByRole('button', { name: 'Element' }))
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(names).toContain('Status markers')
    expect(names).not.toContain('Vote boxes')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Status markers' }))
    const trail = await screen.findByRole('navigation', { name: 'Where it is' })
    expect(within(trail).getByRole('button', { name: 'Status' })).toBeTruthy()
    fireEvent.click(within(trail).getByRole('button', { name: 'Status' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy()
  })
})

describe('a Home block’s actions', () => {
  it('duplicates, moves and removes it from its ⋯ menu', async () => {
    const { seen, onSelect } = show('block-ideas0001', home())
    const menu = await openMenu(screen.getByRole('button', { name: 'Top posts: more actions' }))
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'DuplicateCtrl+D',
      'Move up',
      'Move down',
      'RemoveDelete',
    ])
    expect(items[2]!.getAttribute('aria-disabled')).toBe('true')
    act(() => fireEvent.click(items[0]!))
    expect(seen.design.pages.home.blocks.filter((b) => b.type === 'ideas')).toHaveLength(2)
    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/^block-/))
  })
})

describe('a page section’s panel', () => {
  it('has no actions nor layout, and offers the elements it draws', () => {
    show('topics')
    expect(screen.queryByRole('button', { name: /more actions/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Layout' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Look' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Element' })).toBeTruthy()
  })
})

describe('an element opened from a Home block', () => {
  const three = () => {
    const design = home()
    design.pages.home.blocks.push({ ...newBlock('status', { y: 2 }), id: 'status001' })
    return design
  }

  it('opens at the block, with the way back to every one of its kind', async () => {
    show('block-status001', three())
    const menu = await openMenu(screen.getByRole('button', { name: 'Element' }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Status markers' }))
    await screen.findByRole('navigation', { name: 'Where it is' })
    expect(screen.getByRole('button', { name: /^Back to every/ })).toBeTruthy()
  })

  it('shows its phone values on the canvas’s own phone', async () => {
    const onPhone = vi.fn()
    show('block-status001', three(), false, [], onPhone)
    const menu = await openMenu(screen.getByRole('button', { name: 'Element' }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Status markers' }))
    const chip = await screen.findByRole('radiogroup', { name: 'Editing' })
    fireEvent.click(within(chip).getByRole('radio', { name: 'Phone' }))
    expect(onPhone).toHaveBeenCalledWith(true)
  })
})

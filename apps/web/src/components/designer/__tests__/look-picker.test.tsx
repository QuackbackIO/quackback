// @vitest-environment happy-dom
/**
 * Pointing at a look or a Home layout shows it on the canvas and changes
 * nothing; leaving shows the draft again; only choosing one changes the draft.
 * A look keeps the workspace's own colours and fonts; "Use its colours too"
 * takes them as well. A workspace keeps its own looks beside the presets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { lookOf } from '@/lib/shared/design/looks'
import { DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { newBlock } from '@/lib/shared/design/home'

const fns = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
}))
const events = vi.hoisted(() => ({ designerLookChosen: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)
vi.mock('@/lib/server/functions/portal-design-saved', () => ({
  listPortalDesignSavedFn: fns.list,
  savePortalDesignFn: fns.save,
  getPortalDesignCheckpointFn: fns.read,
  deletePortalDesignSavedFn: fns.remove,
}))

const { LookPicker } = await import('../look-picker')
const { HomeLayoutPicker } = await import('../home-layout-picker')
const { usePreviewedDesign, previewOnCanvas } = await import('../look-preview')

/** A target at least 24px tall, as small text links and buttons are given. */
const at24 = (el: Element) => expect(el.className).toMatch(/(^|\s)(min-h-6|size-6|min-h-7)(\s|$)/)

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const mine = (() => {
  const design = defaultDesign()
  design.brand.light.accent = '#0f766e'
  return design
})()

beforeEach(() => {
  fns.list.mockReset().mockResolvedValue({
    checkpoints: [
      {
        id: 'portal_design_saved_cp',
        name: 'Before band',
        createdAt: '2026-11-01T10:00:00.000Z',
        createdBy: 'Ada',
      },
    ],
    looks: [
      {
        id: 'portal_design_saved_look',
        name: 'Teal',
        createdAt: '2026-11-01T10:00:00.000Z',
        createdBy: 'Ada',
        look: lookOf(mine),
      },
    ],
  })
  fns.save.mockReset().mockResolvedValue({ ok: true, entry: {} })
  fns.read.mockReset().mockResolvedValue({ ok: true, design: mine, name: 'Before band' })
  fns.remove.mockReset().mockResolvedValue({ ok: true })
  previewOnCanvas(null)
})
afterEach(cleanup)

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('LookPicker', () => {
  it('counts a chosen look by where it came from, just before it changes the draft', async () => {
    const order: string[] = []
    events.designerLookChosen.mockImplementation((source: string) => order.push(source))
    const update = vi.fn(() => order.push('update'))
    render(wrap(<LookPicker design={defaultDesign()} update={update} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Teal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Studio' }))
    expect(order).toEqual(['saved', 'update', 'preset', 'update'])
  })

  it('shows a look on the canvas while pointed at, and changes the draft only when chosen', async () => {
    const update = vi.fn()
    const design = structuredClone(mine)
    render(wrap(<LookPicker design={design} update={update} />))
    const shown = renderHook(() => usePreviewedDesign())

    const studio = await screen.findByRole('button', { name: 'Studio' })
    fireEvent.pointerEnter(studio)
    // The brand's own colours, with the look's treatment.
    expect(shown.result.current?.brand.light.accent).toBe('#0f766e')
    expect(shown.result.current?.layout.hero).toBe('brand')
    expect(update).not.toHaveBeenCalled()
    fireEvent.pointerLeave(studio)
    expect(shown.result.current).toBeNull()

    // Focus previews as pointing does.
    act(() => studio.focus())
    expect(shown.result.current?.layout.hero).toBe('brand')
    fireEvent.click(studio)
    expect(shown.result.current).toBeNull()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]![1]).toBe('Look: Studio')
    const draft = structuredClone(design)
    update.mock.calls[0]![0](draft)
    expect(draft.layout.hero).toBe('brand')
    expect(draft.brand.light).toEqual(mine.brand.light)
    expect(draft.brand.fonts.heading).toEqual(mine.brand.fonts.heading)
  })

  it('takes a look’s colours and fonts too, as one step, from its second action', async () => {
    const order: string[] = []
    events.designerLookChosen.mockImplementation((source: string) => order.push(source))
    const update = vi.fn<(change: (draft: PortalDesign) => void, label?: string) => void>(() => {
      order.push('update')
    })
    const design = structuredClone(mine)
    render(wrap(<LookPicker design={design} update={update} />))
    const shown = renderHook(() => usePreviewedDesign())
    const studio = DESIGN_PRESETS.find((each) => each.id === 'studio')!

    const its = await screen.findByRole('button', { name: 'Studio: use its colours too' })
    at24(its)
    act(() => its.focus())
    expect(shown.result.current?.brand.light.accent).toBe(studio.look.brand.light.accent)
    fireEvent.click(its)
    expect(shown.result.current).toBeNull()
    expect(order).toEqual(['preset', 'update'])
    expect(update.mock.calls[0]![1]).toBe('Look and colours: Studio')
    const draft = structuredClone(design)
    update.mock.calls[0]![0](draft)
    expect(draft.brand.light).toEqual(studio.look.brand.light)
    expect(draft.brand.fonts.heading).toEqual(studio.look.brand.fonts.heading)
    expect(draft.mode).toBe(studio.look.mode)
  })

  it('draws each tile in the workspace’s own accent and logo', async () => {
    render(wrap(<LookPicker design={mine} update={vi.fn()} logoUrl="/logo.png" />))
    const studio = await screen.findByRole('button', { name: 'Studio' })
    const band = studio.querySelector<HTMLElement>('[data-tile-band]')!
    expect(band.style.background).toContain('#0f766e')
    expect(studio.querySelector('img')?.getAttribute('src')).toBe('/logo.png')
  })

  it('saves the draft’s look under a name, and deletes a saved one', async () => {
    const design = defaultDesign()
    render(wrap(<LookPicker design={design} update={vi.fn()} />))
    fireEvent.click(screen.getByRole('button', { name: 'Save this look' }))
    fireEvent.change(screen.getByLabelText('Name this look'), { target: { value: 'Launch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(fns.save).toHaveBeenCalledWith({ data: { kind: 'look', name: 'Launch', design } })
    )
    const remove = await screen.findByRole('button', { name: 'Delete Teal' })
    at24(remove)
    fireEvent.click(remove)
    await waitFor(() =>
      expect(fns.remove).toHaveBeenCalledWith({ data: { id: 'portal_design_saved_look' } })
    )
  })
})

describe('HomeLayoutPicker', () => {
  it('previews an arrangement, keeping written blocks, and applies it when chosen', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [newBlock('links')]
    const update = vi.fn()
    render(<HomeLayoutPicker design={design} update={update} gates={ALL_ON} />)
    const shown = renderHook(() => usePreviewedDesign())
    const help = screen.getByRole('button', { name: 'Help first' })
    fireEvent.pointerEnter(help)
    const blocks = shown.result.current?.pages.home.blocks ?? []
    expect(blocks[0]?.type).toBe('help_search')
    expect(blocks.at(-1)?.type).toBe('links')
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(help)
    expect(shown.result.current).toBeNull()
    const draft: PortalDesign = structuredClone(design)
    update.mock.calls[0]![0](draft)
    expect(draft.pages.home.blocks[0]?.type).toBe('help_search')
  })
})

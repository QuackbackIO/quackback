// @vitest-environment happy-dom
/**
 * Pointing at a look or a Home layout shows it on the canvas and changes
 * nothing; leaving shows the draft again; only choosing one changes the draft.
 * A workspace keeps its own looks beside the presets.
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
    const design = defaultDesign()
    render(wrap(<LookPicker design={design} update={update} />))
    const shown = renderHook(() => usePreviewedDesign())

    const teal = await screen.findByRole('button', { name: 'Teal' })
    fireEvent.pointerEnter(teal)
    expect(shown.result.current?.brand.light.accent).toBe('#0f766e')
    expect(update).not.toHaveBeenCalled()
    fireEvent.pointerLeave(teal)
    expect(shown.result.current).toBeNull()

    // Focus previews as pointing does.
    const studio = screen.getByRole('button', { name: 'Studio' })
    act(() => studio.focus())
    expect(shown.result.current?.layout.band).toBe('brand')
    fireEvent.click(studio)
    expect(shown.result.current).toBeNull()
    expect(update).toHaveBeenCalledTimes(1)
    const draft = structuredClone(design)
    update.mock.calls[0]![0](draft)
    expect(draft.layout.band).toBe('brand')
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
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Teal' }))
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

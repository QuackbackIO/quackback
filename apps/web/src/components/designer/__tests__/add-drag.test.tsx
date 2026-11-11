// @vitest-environment happy-dom
/**
 * Dragging a block from Add onto the page: past a few px the card follows
 * the pointer and a catcher covers the canvas; over Home's grid the new
 * block takes its place live, the others moving aside, and a drop is one
 * step that picks it and is said aloud. Escape, a drop off the canvas or a
 * drop on another page adds nothing. A click still adds. The frame is this
 * window, its canvas the top left 1200 by 800.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { newBlock, type HomeBlockType } from '@/lib/shared/design/home'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('../home-layout-picker', () => ({ HomeLayoutPicker: () => null }))
vi.mock('../frame-reflow', () => ({ snapshotBlocks: () => null, playReflow: () => {} }))

const { AddContent } = await import('../add-sheet')
const { AddDragCard, AddDropLayer, useAddDrag } = await import('../use-add-drag')

afterEach(() => {
  cleanup()
  document.querySelector('[data-test-page]')?.remove()
})

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/** Home's grid as the frame draws it, from (100, 50): twelve columns of 60 with 20 between, rows of 24. */
function homePage(columns = 12) {
  const grid = document.createElement('div')
  grid.setAttribute('data-test-page', '')
  grid.setAttribute('data-qb-grid', '')
  grid.style.display = 'grid'
  grid.style.gridTemplateColumns = Array(columns).fill('60px').join(' ')
  grid.style.gridTemplateRows = '24px 24px 24px'
  grid.style.columnGap = '20px'
  grid.style.rowGap = '16px'
  grid.getBoundingClientRect = () => new DOMRect(100, 50, 940, 200)
  document.body.append(grid)
  return {
    contentDocument: document,
    contentWindow: window,
    getBoundingClientRect: () => new DOMRect(0, 0, 1200, 800),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLIFrameElement
}

function show({ page = 'home' as DesignerPage, columns = 12 } = {}) {
  const frame = homePage(columns)
  let design = defaultDesign()
  design.pages.home.blocks = [
    { ...newBlock('welcome', { x: 0, y: 0, w: 12, h: 1 }), id: 'welcome01' },
    { ...newBlock('ideas', { x: 0, y: 1, w: 6, h: 1 }), id: 'ideas0001' },
    { ...newBlock('updates', { x: 6, y: 1, w: 6, h: 1 }), id: 'updates01' },
  ]
  const labels: Array<string | undefined> = []
  const steps: string[] = []
  const say = vi.fn()
  const onAdded = vi.fn()
  const onAdd = vi.fn()
  const update = (change: (draft: PortalDesign) => void, label?: string) => {
    const next = structuredClone(design)
    change(next)
    design = next
    labels.push(label)
  }
  function Harness() {
    const drag = useAddDrag({
      design,
      gates: ALL_ON,
      page,
      update,
      begin: (label) => void steps.push(`begin ${label}`),
      end: () => void steps.push('end'),
      say,
      onAdded,
    })
    return (
      <>
        <AddContent
          design={design}
          update={update}
          gates={ALL_ON}
          after={null}
          onHome={page === 'home'}
          onAdd={onAdd}
          drag={drag}
        />
        <div data-test-layer="">
          <AddDropLayer
            canvas={{ frame, scale: 1, room: { width: 1200, height: 800 } }}
            drag={drag}
          />
        </div>
        <AddDragCard drag={drag} />
      </>
    )
  }
  render(<Harness />)
  const card = (name: RegExp) => screen.getByRole('button', { name })
  const types = () => design.pages.home.blocks.map((block) => block.type as HomeBlockType)
  const placeOf = (type: HomeBlockType) =>
    design.pages.home.blocks.find((block) => block.type === type)!.grid
  return { say, labels, steps, onAdded, onAdd, card, types, placeOf }
}

const catcher = () => document.querySelector('[data-add-catcher]')
const dragged = () => document.querySelector('[data-add-drag-card]')
const ghost = () => document.querySelector('[data-add-ghost]')

/** A press on a card, then the pointer moved to points in the builder's viewport. */
function drag(card: HTMLElement, ...points: Array<[number, number]>) {
  fireEvent.pointerDown(card, { button: 0, clientX: 1300, clientY: 100 })
  for (const [x, y] of points)
    act(() => void fireEvent.pointerMove(window, { clientX: x, clientY: y }))
}

describe('dragging a block from Add', () => {
  it('stays a click when the pointer barely moves', () => {
    const { card, onAdd, labels } = show()
    drag(card(/^Status/), [1302, 101])
    expect(dragged()).toBeNull()
    act(() => void fireEvent.pointerUp(window))
    fireEvent.click(card(/^Status/))
    expect(onAdd).toHaveBeenCalledWith('status')
    expect(labels).toEqual([])
  })

  it('follows the pointer and covers the canvas once it moves', () => {
    const { card, say } = show()
    drag(card(/^Status/), [1250, 120])
    expect(dragged()?.textContent).toContain('Status')
    expect(catcher()).not.toBeNull()
    expect(say).toHaveBeenLastCalledWith('Drop Status on the page, or press Escape.')
  })

  it('puts the block where it is dropped, as one step, picks it and says where', () => {
    const { card, say, labels, steps, onAdded, placeOf, types } = show()
    // Status is 4 columns: centred on x 730 it starts at column 6, in the row of the pointer.
    drag(card(/^Status/), [1250, 120], [730, 52])
    expect(ghost()).not.toBeNull()
    expect(types()).toContain('status')
    expect(placeOf('status')).toMatchObject({ x: 6, y: 0 })
    // The block in its way moves down, live.
    expect(placeOf('welcome').y).toBe(1)
    act(() => void fireEvent.pointerUp(window))
    expect(steps).toEqual(['begin Add Status', 'end'])
    expect(labels.every((label) => label === 'Add Status')).toBe(true)
    expect(onAdded).toHaveBeenCalledWith(expect.stringMatching(/^block-/))
    expect(say).toHaveBeenLastCalledWith('Status added at row 1, column 7.')
    expect(catcher()).toBeNull()
    expect(dragged()).toBeNull()
  })

  it('takes the block back off when the pointer leaves the canvas, and adds nothing there', () => {
    const { card, types, onAdded, say } = show()
    drag(card(/^Status/), [1250, 120], [730, 52])
    expect(types()).toContain('status')
    act(() => void fireEvent.pointerMove(window, { clientX: 1300, clientY: 120 }))
    expect(types()).not.toContain('status')
    act(() => void fireEvent.pointerUp(window))
    expect(onAdded).not.toHaveBeenCalled()
    expect(say).toHaveBeenLastCalledWith('Status not added.')
  })

  it('adds nothing on Escape', () => {
    const { card, types, onAdded, steps, say } = show()
    drag(card(/^Status/), [1250, 120], [730, 52])
    act(() => void fireEvent.keyDown(window, { key: 'Escape' }))
    expect(types()).not.toContain('status')
    expect(dragged()).toBeNull()
    act(() => void fireEvent.pointerUp(window))
    expect(onAdded).not.toHaveBeenCalled()
    expect(steps).toEqual(['begin Add Status', 'end'])
    expect(say).toHaveBeenLastCalledWith('Status not added.')
  })

  it('refuses a drop on another page, with a short note', () => {
    const { card, types, onAdded, say } = show({ page: 'roadmap' })
    expect(card(/^Status/).textContent).toContain('Goes on Home')
    drag(card(/^Status/), [1250, 120], [730, 52])
    expect(dragged()?.textContent).toContain('Goes on Home. Click it to add it there.')
    expect(ghost()).toBeNull()
    act(() => void fireEvent.pointerUp(window))
    expect(types()).not.toContain('status')
    expect(onAdded).not.toHaveBeenCalled()
    expect(say).toHaveBeenLastCalledWith('Goes on Home. Click it to add it there.')
  })

  it('refuses a drop outside the desktop view', () => {
    const { card, types } = show({ columns: 2 })
    drag(card(/^Status/), [1250, 120], [730, 52])
    expect(dragged()?.textContent).toContain('Drop blocks in the desktop view.')
    act(() => void fireEvent.pointerUp(window))
    expect(types()).not.toContain('status')
  })

  it('shows a block Home holds once and has as used, and it does not drag', () => {
    const { card, say } = show()
    const updates = card(/^Latest updates/)
    // One status word for every block on Home; a block it holds once is greyed.
    expect(updates.querySelector('[data-card-tag]')?.textContent).toBe('On Home')
    expect(updates.hasAttribute('disabled')).toBe(true)
    drag(updates, [1250, 120])
    expect(dragged()).toBeNull()
    expect(say).not.toHaveBeenCalled()
    // Top posts can repeat: on Home, and it still drags.
    expect(card(/^Top posts/).textContent).toContain('On Home')
    expect(card(/^Top posts/).hasAttribute('disabled')).toBe(false)
  })
})

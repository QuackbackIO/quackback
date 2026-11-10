import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { addDropRefusal, addedWords, dropCell } from '@/lib/shared/design/add-drop'
import { measureGrid, placeRect } from '@/lib/shared/design/grid-geometry'
import {
  insertHomeBlockAt,
  newBlock,
  type HomeBlock,
  type HomeBlockType,
} from '@/lib/shared/design/home'
import type { GridPlace } from '@/lib/shared/design/home-grid'
import { toLayerRect, type Rect } from '@/lib/shared/design/layer-geometry'
import { BLOCK_NAMES, type DesignerPage } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { CanvasFrame } from './designer-canvas'
import { playReflow, snapshotBlocks } from './frame-reflow'
import { BlockIcon } from './block-icon'
import { useFrameRects } from './use-frame-rects'
import { swallowClick } from './use-grid-edit'

/** The layer's own blue, as the picked block's outline uses it. */
const BLUE = '#2563eb'
/** How far the pointer goes before a press on a card becomes a drag, in px. */
const THRESHOLD = 4
/** How near the canvas's top or bottom the pointer scrolls the page, and by how much. */
const EDGE_ZONE = 32
const EDGE_STEP = 16

/** What the builder draws while a block is dragged from Add. */
export interface AddDragView {
  type: HomeBlockType
  name: string
  /** The pointer, in the builder's viewport. */
  x: number
  y: number
  /** Where the pointer holds the card, from its top left, and the card's width. */
  hold: { x: number; y: number; width: number }
  /** Whether the pointer is over the canvas. */
  over: boolean
  /** The cells the block lands on, on the layer, as measured when it moved there. */
  ghost: Rect | null
  /** The new block's key while it is on the page, so the layer can follow where it is drawn. */
  key: string | null
  /** Why it cannot be dropped here. */
  note: string | null
}

interface Drag {
  type: HomeBlockType
  name: string
  start: { x: number; y: number }
  hold: AddDragView['hold']
  began: boolean
  /** The design when the drag began, which each step lays out from. */
  before: PortalDesign | null
  /** The new block, with its id kept for the whole drag. */
  block: HomeBlock
  /** Where it is on Home now; null while it is not. */
  landed: GridPlace | null
  cell: string
  note: string | null
  detach: () => void
}

/**
 * Dragging a block from the Add sheet onto the page. A press on a card that
 * moves a few px becomes a drag: the card follows the pointer, and a catcher
 * covers the canvas so the frame does not take the pointer. Over Home's grid
 * in the desktop view the new block is put in place live, the others moving
 * aside as moving a block moves them; a drop there is one step that picks
 * it. Off the canvas, on another page, or with Escape, nothing is added.
 */
export function useAddDrag({
  design,
  gates,
  page,
  update,
  begin,
  end,
  say,
  onAdded,
}: {
  design: PortalDesign
  gates: PortalPageGates
  page: DesignerPage
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  begin: (label: string) => void
  end: () => void
  say: (words: string) => void
  /** The block dropped, by its key, to pick it and close the sheet. */
  onAdded: (key: `block-${string}`) => void
}) {
  const [view, setView] = useState<AddDragView | null>(null)
  const dragging = useRef<Drag | null>(null)
  const canvas = useRef<CanvasFrame | null>(null)

  /** Home's blocks as they were, with the new block at a cell, or without it. */
  function lay(drag: Drag, cell: Pick<GridPlace, 'x' | 'y'> | null) {
    const before = drag.before
    if (!before) return
    const doc = canvas.current?.frame?.contentDocument ?? null
    const shot = snapshotBlocks(doc)
    let landed: GridPlace | null = null
    update((draft) => {
      draft.pages.home.blocks = structuredClone(before.pages.home.blocks)
      if (cell) landed = insertHomeBlockAt(draft, gates, structuredClone(drag.block), cell)
    }, `Add ${drag.name}`)
    drag.landed = cell ? landed : null
    playReflow(doc, shot)
  }

  function finish(cancel: boolean) {
    const drag = dragging.current
    dragging.current = null
    if (!drag) return
    drag.detach()
    if (!drag.began) return
    setView(null)
    swallowClick(window)
    const landed = cancel ? null : drag.landed
    if (!landed) {
      if (drag.landed) lay(drag, null)
      end()
      say(!cancel && drag.note ? drag.note : `${drag.name} not added.`)
      return
    }
    end()
    onAdded(`block-${drag.block.id}`)
    say(addedWords(drag.name, landed))
  }

  /** Follows the pointer, at a point in the builder's viewport. */
  function follow(x: number, y: number) {
    const drag = dragging.current
    if (!drag) return
    if (!drag.began) {
      if (Math.hypot(x - drag.start.x, y - drag.start.y) < THRESHOLD) return
      drag.began = true
      drag.before = structuredClone(design)
      begin(`Add ${drag.name}`)
      say(`Drop ${drag.name} on the page, or press Escape.`)
    }
    const at = canvas.current
    const frame = at?.frame
    const box = frame?.getBoundingClientRect()
    const over =
      !!box &&
      !!at &&
      x >= box.left &&
      y >= box.top &&
      x <= box.left + Math.min(box.width, at.room.width) &&
      y <= box.top + Math.min(box.height, at.room.height)
    let ghost: Rect | null = null
    let note: string | null = null
    if (over && at && frame && box) {
      const win = frame.contentWindow
      // Near the canvas's top or bottom, the page scrolls on.
      if (y - box.top > at.room.height - EDGE_ZONE) win?.scrollBy(0, EDGE_STEP)
      else if (y - box.top < EDGE_ZONE) win?.scrollBy(0, -EDGE_STEP)
      const grid = page === 'home' ? frame.contentDocument?.querySelector('[data-qb-grid]') : null
      const m = grid ? measureGrid(grid) : null
      note = addDropRefusal(drag.before ?? design, gates, drag.type, {
        page,
        columns: m?.columns ?? null,
      })
      if (!note && m) {
        const point = { x: (x - box.left) / at.scale, y: (y - box.top) / at.scale }
        const cell = dropCell(m, drag.type, point)
        const key = `${cell.x},${cell.y}`
        if (key !== drag.cell) {
          drag.cell = key
          lay(drag, cell)
        }
        if (drag.landed) ghost = toLayerRect(placeRect(m, drag.landed), at.scale)
      }
    }
    if (!ghost && drag.landed) {
      drag.cell = ''
      lay(drag, null)
    }
    drag.note = note
    const key = ghost ? `block-${drag.block.id}` : null
    setView({ type: drag.type, name: drag.name, x, y, hold: drag.hold, over, ghost, note, key })
  }

  /** A press on a card in the Add sheet, which may become a drag. */
  function press(type: HomeBlockType, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || dragging.current) return
    const card = event.currentTarget.getBoundingClientRect()
    const onMove = (move: PointerEvent) => live.current.follow(move.clientX, move.clientY)
    const onUp = () => live.current.finish(false)
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !dragging.current?.began) return
      key.preventDefault()
      key.stopPropagation()
      live.current.finish(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey, true)
    dragging.current = {
      type,
      name: BLOCK_NAMES[type],
      start: { x: event.clientX, y: event.clientY },
      hold: { x: event.clientX - card.left, y: event.clientY - card.top, width: card.width },
      began: false,
      before: null,
      block: newBlock(type),
      landed: null,
      cell: '',
      note: null,
      detach: () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('keydown', onKey, true)
      },
    }
  }

  // Listeners added once read the newest of these.
  const live = useRef({ follow, finish })
  live.current = { follow, finish }

  useEffect(() => () => dragging.current?.detach(), [])
  /** The canvas the block is dropped on, as the layer over it has it. */
  const setCanvas = useRef((next: CanvasFrame | null) => {
    canvas.current = next
  }).current

  return { view, press, setCanvas }
}

export type AddDrag = ReturnType<typeof useAddDrag>

/**
 * On the editing layer while a block is dragged from Add: a catcher over the
 * whole canvas, so the frame does not take the pointer, and the cells the
 * block lands on.
 */
export function AddDropLayer({ canvas, drag }: { canvas: CanvasFrame; drag: AddDrag }) {
  const { setCanvas, view } = drag
  useEffect(() => {
    setCanvas(canvas)
    return () => setCanvas(null)
  }, [setCanvas, canvas])
  // The new block as the page draws it, once it has; its rows grow to fit what it shows.
  const rects = useFrameRects(canvas.frame, canvas.scale, [view?.key ?? null])
  if (!view) return null
  const ghost = (view.key && rects[view.key]) || view.ghost
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        data-add-catcher=""
        className="pointer-events-auto absolute inset-0"
        style={{ cursor: view.over && view.note ? 'not-allowed' : 'grabbing' }}
      />
      {ghost && (
        <div
          data-add-ghost=""
          className="absolute rounded-md border-2 border-dashed transition-[left,top,width,height] duration-150 ease-out motion-reduce:transition-none"
          style={{ ...ghost, borderColor: BLUE, background: `${BLUE}14` }}
        />
      )}
    </div>
  )
}

/** The card as the pointer holds it while dragged from Add, with why it cannot drop here. */
export function AddDragCard({ drag }: { drag: AddDrag }) {
  const { view } = drag
  if (!view) return null
  return createPortal(
    <div
      aria-hidden="true"
      data-add-drag-card=""
      className="pointer-events-none fixed z-50 space-y-1.5"
      style={{ left: view.x - view.hold.x, top: view.y - view.hold.y, width: view.hold.width }}
    >
      <div
        className="flex items-center gap-3 rounded-lg border bg-background p-2 shadow-lg"
        style={{ borderColor: BLUE, opacity: view.ghost ? 0.6 : 0.95 }}
      >
        <span className="grid h-10 w-14 shrink-0 place-items-center rounded-md bg-muted">
          <BlockIcon type={view.type} className="size-4" />
        </span>
        <span className="text-[13px] font-medium">{view.name}</span>
      </div>
      {view.over && view.note && (
        <p className="w-fit rounded-md bg-foreground px-2 py-1 text-xs text-background shadow">
          {view.note}
        </p>
      )}
    </div>,
    document.body
  )
}

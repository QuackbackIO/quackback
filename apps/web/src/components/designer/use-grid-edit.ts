import { useEffect, useRef, useState } from 'react'
import {
  editGrid,
  movedWords,
  resizedWords,
  resizes,
  stepOfKey,
  type GridChange,
} from '@/lib/shared/design/grid-edit'
import {
  columnAt,
  columnsTo,
  measureGrid,
  placeRect,
  rowAt,
  rowsTo,
  type GridMetrics,
} from '@/lib/shared/design/grid-geometry'
import { homeGridItems } from '@/lib/shared/design/home'
import { GRID_COLUMNS, settle, type GridPlace } from '@/lib/shared/design/home-grid'
import { toLayerRect, type Rect } from '@/lib/shared/design/layer-geometry'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { playReflow, snapshotBlocks } from './frame-reflow'
import { blockElement } from './use-frame-rects'

/** What the builder lends the layer to move and resize Home's blocks. */
export interface GridEditing {
  design: PortalDesign
  gates: PortalPageGates
  /** Changes the draft under a name, so undo says what it takes back. */
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  /** Makes the changes until `end` one step, such as a drag. */
  begin: (label: string) => void
  end: () => void
  say: (words: string) => void
}

/** What a drag holds: the block's grip or its body moves it; an edge or the corner resizes it. */
export type GridEdge = 'move' | 'right' | 'bottom' | 'corner'

/** What the layer draws while a block is dragged, on the layer. */
export interface GridDragView {
  edge: GridEdge
  /** The block as the pointer holds it. */
  lifted: Rect
  /** The cells it lands on. */
  ghost: Rect | null
}

/** A key press as the grid reads it. */
export type GridKey = Pick<KeyboardEvent, 'key'> &
  Partial<Pick<KeyboardEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>>

interface Drag {
  edge: GridEdge
  id: string
  name: string
  /** Where the pointer went down, in the builder's viewport. */
  start: { x: number; y: number }
  scroll: number
  /** The block's box from the grid's top left, in the frame, when the drag began. */
  box: Rect
  /** The block's box on the layer when the drag began. */
  layerBox: Rect
  /** How tall the block's content is on the layer: it never shows shorter. */
  least: number
  origin: GridPlace
  /** Home's blocks when the drag began; each step lays out from them. */
  blocks: PortalDesign['pages']['home']['blocks']
  landed: GridPlace
  began: boolean
  last: string
  /** Whether the pointer went down in the frame's page, not on the layer. */
  inFrame: boolean
  detach: () => void
}

/** How far the pointer goes before a press becomes a drag, in px. */
const THRESHOLD = 4
/** How near the canvas's top or bottom the pointer scrolls the page, and by how much. */
const EDGE_ZONE = 32
const EDGE_STEP = 16
/** Fields where keys and presses belong to what is typed, not to moving blocks. */
const TYPING = '[data-qb-words-editing], input, textarea, select, [contenteditable="true"]'

const gridOf = (doc: Document | null | undefined) => doc?.querySelector('[data-qb-grid]') ?? null
const samePlace = (a: GridPlace, b: GridPlace) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** Where the block lands for a pointer this far from where it went down, in the frame's px. */
function changeFor(drag: Drag, m: GridMetrics, dx: number, dy: number): GridChange {
  const { box, origin } = drag
  if (drag.edge === 'move')
    return { move: { x: columnAt(m, box.left + dx, origin.w), y: rowAt(m, box.top + dy) } }
  const w = drag.edge === 'bottom' ? origin.w : columnsTo(m, origin.x, box.left + box.width + dx)
  const h = drag.edge === 'right' ? origin.h : rowsTo(m, origin.y, box.top + box.height + dy)
  return { size: { w, h } }
}

/**
 * How tall an element's content is, whatever height its row stretches it to:
 * its children, the gaps between them, its padding and its border. A block
 * dragged shorter than this shows it can go no shorter.
 */
export function contentHeight(element: Element): number {
  const view = element.ownerDocument.defaultView
  if (!view) return 0
  const style = view.getComputedStyle(element)
  const px = (value: string) => Number.parseFloat(value) || 0
  const children = [...element.children].filter(
    (child) => view.getComputedStyle(child).position !== 'absolute'
  )
  // Margins are left out: a link pushed to the bottom has an auto margin as tall as the room left.
  const inner = children.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0)
  const gaps = Math.max(0, children.length - 1) * px(style.rowGap)
  const edges = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const
  return inner + gaps + edges.reduce((sum, edge) => sum + px(style[edge]), 0)
}

/** The click a drag ends with in the page, which would otherwise pick what it lands on. */
export function swallowClick(win: Window | null | undefined) {
  if (!win) return
  const stop = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  win.addEventListener('click', stop, { capture: true, once: true })
  // A drag that ends without a click leaves the next click alone.
  win.setTimeout(() => win.removeEventListener('click', stop, { capture: true }), 0)
}

/**
 * Moving and resizing the picked Home block on the canvas: by dragging its
 * grip or its body, by dragging its right edge, bottom edge or corner, and
 * with the arrow keys (Shift to resize). The page reflows as it goes, other
 * blocks gliding to their places; a drag is one step to undo, and each change
 * is said aloud. Only on a desktop-wide canvas, where the grid has its twelve
 * columns.
 */
export function useGridEdit({
  frame,
  scale,
  room,
  picked,
  name,
  editing,
}: {
  frame: HTMLIFrameElement | null
  scale: number
  room: { width: number; height: number }
  picked: string | null
  name: string | null
  editing?: GridEditing
}) {
  const [view, setView] = useState<GridDragView | null>(null)
  const dragging = useRef<Drag | null>(null)

  const id = picked?.startsWith('block-') ? picked.slice('block-'.length) : null
  const onGrid =
    !!editing &&
    !!id &&
    homeGridItems(editing.design.pages.home, editing.gates).some((item) => item.id === id)
  const page = () => frame?.contentDocument ?? null
  const metrics = () => {
    const grid = gridOf(page())
    return grid ? measureGrid(grid) : null
  }
  const called = name ?? 'Block'

  /** Lays the draft out from where the drag began, with one change made, or none. */
  function apply(drag: Drag, change: GridChange | null) {
    if (!editing) return
    const before = snapshotBlocks(page())
    let landed = drag.origin
    editing.update((draft) => {
      draft.pages.home.blocks = structuredClone(drag.blocks)
      if (change) landed = editGrid(draft, editing.gates, drag.id, change) ?? drag.origin
    })
    drag.landed = landed
    playReflow(page(), before)
  }

  function finish(cancel: boolean) {
    const drag = dragging.current
    dragging.current = null
    setView(null)
    if (!drag) return
    drag.detach()
    if (!drag.began || !editing) return
    const doc = page()
    if (doc) doc.documentElement.style.userSelect = ''
    if (drag.inFrame) swallowClick(frame?.contentWindow)
    if (cancel) {
      apply(drag, null)
      editing.end()
      editing.say(`${drag.name} put back.`)
      return
    }
    editing.end()
    if (samePlace(drag.landed, drag.origin)) return
    editing.say(
      drag.edge === 'move'
        ? movedWords(drag.name, drag.landed)
        : resizedWords(drag.name, drag.landed)
    )
  }

  /** Follows the pointer, at a point in the builder's viewport. */
  function follow(x: number, y: number) {
    const drag = dragging.current
    const win = frame?.contentWindow
    if (!drag || !editing || !win || !frame) return
    const dx = (x - drag.start.x) / scale
    const dy = (y - drag.start.y) / scale + (win.scrollY - drag.scroll)
    if (!drag.began) {
      if (Math.hypot(dx, dy) < THRESHOLD) return
      drag.began = true
      editing.begin(`${drag.edge === 'move' ? 'Move' : 'Resize'} ${drag.name}`)
      win.document.getSelection()?.removeAllRanges()
      win.document.documentElement.style.userSelect = 'none'
    }
    // Near the canvas's top or bottom, the page scrolls on.
    const top = frame.getBoundingClientRect().top
    if (y - top > room.height - EDGE_ZONE) win.scrollBy(0, EDGE_STEP)
    else if (y - top < EDGE_ZONE) win.scrollBy(0, -EDGE_STEP)
    const m = metrics()
    if (!m) return
    const change = changeFor(drag, m, dx, dy)
    const key = JSON.stringify(change)
    if (key !== drag.last) {
      drag.last = key
      apply(drag, change)
    }
    const shift = { x: x - drag.start.x, y: y - drag.start.y }
    const held = drag.layerBox
    const lifted =
      drag.edge === 'move'
        ? { ...held, left: held.left + shift.x, top: held.top + shift.y }
        : {
            ...held,
            width: Math.max(16, held.width + (drag.edge === 'bottom' ? 0 : shift.x)),
            height: Math.max(drag.least, held.height + (drag.edge === 'right' ? 0 : shift.y)),
          }
    setView({ edge: drag.edge, lifted, ghost: toLayerRect(placeRect(m, drag.landed), scale) })
  }

  /** Starts a press that may become a drag, at a point in the builder's viewport. */
  function press(edge: GridEdge, x: number, y: number, inFrame: boolean): boolean {
    const doc = page()
    const win = frame?.contentWindow
    if (!editing || !id || !picked || !doc || !win || !frame || dragging.current) return false
    const element = blockElement(doc, picked)
    const m = metrics()
    if (!element || !m || m.columns !== GRID_COLUMNS) return false
    const origin = settle(homeGridItems(editing.design.pages.home, editing.gates)).find(
      (item) => item.id === id
    )
    if (!origin) return false
    const box = element.getBoundingClientRect()
    const place = { x: origin.x, y: origin.y, w: origin.w, h: origin.h }
    // The pointer is followed in the builder and in the frame, which keeps it while pressed.
    const onMove = (event: PointerEvent) => live.current.follow(event.clientX, event.clientY)
    const onFrameMove = (event: PointerEvent) => {
      const at = frame.getBoundingClientRect()
      const s = live.current.scale
      live.current.follow(at.left + event.clientX * s, at.top + event.clientY * s)
    }
    const onUp = () => live.current.finish(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      live.current.finish(true)
    }
    const targets = [window, doc] as const
    for (const target of targets) {
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onUp)
      target.addEventListener('keydown', onKey as EventListener, true)
    }
    window.addEventListener('pointermove', onMove)
    doc.addEventListener('pointermove', onFrameMove)
    dragging.current = {
      edge,
      id,
      name: called,
      start: { x, y },
      scroll: win.scrollY,
      box: { left: box.left - m.left, top: box.top - m.top, width: box.width, height: box.height },
      layerBox: toLayerRect(box, scale),
      least: contentHeight(element) * scale,
      origin: place,
      blocks: structuredClone(editing.design.pages.home.blocks),
      landed: place,
      began: false,
      last: '',
      inFrame,
      detach: () => {
        for (const target of targets) {
          target.removeEventListener('pointerup', onUp)
          target.removeEventListener('pointercancel', onUp)
          target.removeEventListener('keydown', onKey as EventListener, true)
        }
        window.removeEventListener('pointermove', onMove)
        doc.removeEventListener('pointermove', onFrameMove)
      },
    }
    return true
  }

  /** One keyboard step on the picked block; true when the key was one of the grid's. */
  function step(event: GridKey): boolean {
    const nudge = stepOfKey(event)
    if (!nudge || !editing || !id || !onGrid || dragging.current) return false
    if (metrics()?.columns !== GRID_COLUMNS) {
      editing.say('Blocks move and resize in the desktop view.')
      return true
    }
    const change = { nudge }
    const place = editGrid(structuredClone(editing.design), editing.gates, id, change)
    if (!place) {
      editing.say(`${called} cannot go further that way.`)
      return true
    }
    const before = snapshotBlocks(page())
    const gates = editing.gates
    editing.update(
      (draft) => void editGrid(draft, gates, id, change),
      `${resizes(change) ? 'Resize' : 'Move'} ${called}`
    )
    playReflow(page(), before)
    editing.say(resizes(change) ? resizedWords(called, place) : movedWords(called, place))
    return true
  }

  // Listeners added once read the newest of these.
  const live = useRef({ follow, finish, press, step, scale, picked })
  live.current = { follow, finish, press, step, scale, picked }

  useEffect(() => () => dragging.current?.detach(), [])

  // With the picked block on the grid, the arrows work where focus rests: the page, or nothing.
  useEffect(() => {
    if (!onGrid || !frame) return
    const attach = () => {
      const doc = frame.contentDocument
      const onKey = (event: KeyboardEvent) => {
        const target = event.target as Element | null
        const inPage = target?.ownerDocument === doc
        const resting = target === document.body || target === doc?.body
        if (event.defaultPrevented || !(resting || inPage) || target?.closest?.(TYPING)) return
        if (live.current.step(event)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      // A press on the picked block's body in the page can drag it.
      const onDown = (event: PointerEvent) => {
        const key = live.current.picked
        const target = event.target as Element | null
        if (event.button !== 0 || !key || !doc || !target || target.closest(TYPING)) return
        if (!blockElement(doc, key)?.contains(target)) return
        const at = frame.getBoundingClientRect()
        const s = live.current.scale
        live.current.press('move', at.left + event.clientX * s, at.top + event.clientY * s, true)
      }
      window.addEventListener('keydown', onKey)
      doc?.addEventListener('keydown', onKey)
      doc?.addEventListener('pointerdown', onDown)
      return () => {
        window.removeEventListener('keydown', onKey)
        doc?.removeEventListener('keydown', onKey)
        doc?.removeEventListener('pointerdown', onDown)
      }
    }
    let detach = attach()
    // A page loaded afresh in the frame is a new document to listen to.
    const reload = () => {
      detach()
      detach = attach()
    }
    frame.addEventListener('load', reload)
    return () => {
      frame.removeEventListener('load', reload)
      detach()
    }
  }, [onGrid, frame])

  return {
    /** Whether the picked block is on Home's desktop grid, so its grip and handles show. */
    on: onGrid && metrics()?.columns === GRID_COLUMNS,
    view,
    /** Starts a drag from the grip or a handle on the layer. */
    start: (edge: GridEdge, event: { clientX: number; clientY: number; button: number }) => {
      if (event.button === 0) press(edge, event.clientX, event.clientY, false)
    },
    /** Moves or resizes from the keyboard; true when it was one of the grid's keys. */
    step,
  }
}

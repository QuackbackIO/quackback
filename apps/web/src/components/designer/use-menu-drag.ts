import { useEffect, useRef, useState } from 'react'
import type { Rect } from '@/lib/shared/design/layer-geometry'
import {
  isMenuTarget,
  menuDropBar,
  menuDropGap,
  menuDropPlace,
  movableParts,
  type MenuItemBox,
} from '@/lib/shared/design/menu-actions'
import { menuParts, type MenuPartId } from '@/lib/shared/design/menu'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { swallowClick } from './use-grid-edit'
import { blockElement, menuKey } from './use-frame-rects'

/** What dragging a menu item needs from the menu's editing. */
export interface MenuDragEditing {
  /** Moves an item to a place among the parts that can move, as one step; whether it moved. */
  drop: (id: MenuPartId, place: number) => boolean
  say: (words: string) => void
  /** Closes an item's open menu, as a drag begins. */
  dismiss: () => boolean
}

/** What the layer draws while a menu item is dragged, on the layer. */
export interface MenuDragView {
  id: MenuPartId
  label: string
  /** The pointer, where the label's ghost follows. */
  pointer: { left: number; top: number }
  /** The insertion bar between items; none in the gaps either side of the dragged item. */
  bar: Rect | null
}

interface Press {
  id: MenuPartId
  label: string
  /** Where the pointer went down, in the frame's viewport. */
  start: { x: number; y: number }
  began: boolean
  place: number | null
  detach: () => void
}

/** How far the pointer goes, on screen, before a press on an item becomes a drag, in px. */
const THRESHOLD = 4
/** How near the menu's scrolling edge the pointer scrolls it, and by how much, in the frame's px. */
const EDGE_ZONE = 24
const EDGE_STEP = 12

/** The nearest box around the menu that scrolls sideways, as a phone's menu does. */
function scrollerOf(element: Element | null): Element | null {
  for (let at = element; at; at = at.parentElement)
    if (at.scrollWidth > at.clientWidth + 1) {
      const overflow = at.ownerDocument.defaultView?.getComputedStyle(at).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return at
    }
  return null
}

/**
 * Dragging a portal menu item to reorder the menu. A press on an item that
 * moves a few px becomes a drag, so a click still opens the item's menu and
 * a double-click still renames it. While dragging, a ghost of its label
 * follows the pointer and a bar shows where it would go; a drop is one step
 * to undo, said aloud; Escape puts it back. Home stays first and the logo
 * and sign in stay put. The menu never folds into a button: on a phone it
 * scrolls sideways, and scrolls on near its edges while an item is dragged.
 */
export function useMenuDrag({
  frame,
  scale,
  design,
  gates,
  editing,
}: {
  frame: HTMLIFrameElement | null
  scale: number
  design: PortalDesign
  gates: PortalPageGates
  editing: MenuDragEditing
}): MenuDragView | null {
  const [view, setView] = useState<MenuDragView | null>(null)
  const pressed = useRef<Press | null>(null)

  /** The items the menu draws that can move, in its order, with their boxes in the frame. */
  function drawnItems(doc: Document) {
    const movable = movableParts(design, gates)
    const drawn = movable.flatMap((id) => {
      const element = blockElement(doc, menuKey(id))
      return element ? [{ id, box: element.getBoundingClientRect() }] : []
    })
    return { movable, drawn }
  }

  function finish(cancel: boolean) {
    const press = pressed.current
    pressed.current = null
    if (!press) return
    press.detach()
    if (!press.began) return
    setView(null)
    const doc = frame?.contentDocument
    if (doc) {
      doc.documentElement.style.userSelect = ''
      doc.documentElement.style.cursor = ''
      // The frame's elements are its own realm's, so no instanceof here.
      const item = blockElement(doc, menuKey(press.id)) as HTMLElement | null
      if (item?.style) item.style.opacity = ''
    }
    swallowClick(frame?.contentWindow)
    if (cancel) return editing.say(`${press.label} put back.`)
    if (press.place === null || !editing.drop(press.id, press.place))
      editing.say(`${press.label} stays where it was.`)
  }

  /** Follows the pointer, at a point in the frame's viewport. */
  function follow(x: number, y: number) {
    const press = pressed.current
    const doc = frame?.contentDocument
    if (!press || !doc) return
    if (!press.began) {
      if (Math.hypot(x - press.start.x, y - press.start.y) * scale < THRESHOLD) return
      press.began = true
      editing.dismiss()
      doc.getSelection()?.removeAllRanges()
      doc.documentElement.style.userSelect = 'none'
      doc.documentElement.style.cursor = 'grabbing'
      // The item stays in place, faded, while its ghost travels.
      const item = blockElement(doc, menuKey(press.id)) as HTMLElement | null
      if (item?.style) item.style.opacity = '0.4'
      editing.say(`Moving ${press.label}. Escape puts it back.`)
    }
    // Near the edge of a menu that scrolls sideways, it scrolls on.
    const row = blockElement(doc, menuKey(press.id))
    const scroller = scrollerOf(row?.parentElement ?? null)
    if (scroller) {
      const edge = scroller.getBoundingClientRect()
      if (x > edge.right - EDGE_ZONE) scroller.scrollLeft += EDGE_STEP
      else if (x < edge.left + EDGE_ZONE) scroller.scrollLeft -= EDGE_STEP
    }
    const { movable, drawn } = drawnItems(doc)
    const boxes: MenuItemBox[] = drawn.map(({ box }) => ({ left: box.left, width: box.width }))
    const gap = menuDropGap(boxes, x)
    press.place = menuDropPlace(
      movable,
      drawn.map((item) => item.id),
      press.id,
      gap
    )
    const top = Math.min(...drawn.map(({ box }) => box.top))
    const bottom = Math.max(...drawn.map(({ box }) => box.bottom))
    const bar =
      press.place === null || !drawn.length
        ? null
        : {
            left: menuDropBar(boxes, gap) * scale - 1,
            top: top * scale - 2,
            width: 2,
            height: (bottom - top) * scale + 4,
          }
    setView({ id: press.id, label: press.label, pointer: { left: x * scale, top: y * scale }, bar })
  }

  /** A press on a menu item in the frame's page, which may become a drag. */
  function down(event: PointerEvent) {
    const doc = frame?.contentDocument
    const target = event.target as Element | null
    const item = target?.closest?.('[data-qb-menu]')
    const id = item?.getAttribute('data-qb-menu')
    if (event.button !== 0 || !doc || !frame || pressed.current || !isMenuTarget(id)) return
    if (id === 'home' || id === 'logo' || id === 'sign-in') return
    if (!movableParts(design, gates).includes(id)) return
    const win = frame.contentWindow
    const onFrameMove = (move: PointerEvent) => live.current.follow(move.clientX, move.clientY)
    // Outside the frame, as when the pointer leaves it, the builder's point is mapped in.
    const onMove = (move: PointerEvent) => {
      const at = frame.getBoundingClientRect()
      const s = live.current.scale
      live.current.follow((move.clientX - at.left) / s, (move.clientY - at.top) / s)
    }
    const onUp = () => live.current.finish(false)
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !pressed.current?.began) return
      key.preventDefault()
      key.stopPropagation()
      live.current.finish(true)
    }
    // Escape is caught on the windows, before the page's own listeners hear it.
    const targets = [...new Set([window, win ?? window])]
    for (const each of targets) {
      each.addEventListener('pointerup', onUp)
      each.addEventListener('pointercancel', onUp)
      each.addEventListener('keydown', onKey as EventListener, true)
    }
    doc.addEventListener('pointermove', onFrameMove)
    if (win !== window) window.addEventListener('pointermove', onMove)
    pressed.current = {
      id,
      label: menuParts(design, gates).find((part) => part.id === id)?.label ?? id,
      start: { x: event.clientX, y: event.clientY },
      began: false,
      place: null,
      detach: () => {
        for (const each of targets) {
          each.removeEventListener('pointerup', onUp)
          each.removeEventListener('pointercancel', onUp)
          each.removeEventListener('keydown', onKey as EventListener, true)
        }
        doc.removeEventListener('pointermove', onFrameMove)
        window.removeEventListener('pointermove', onMove)
      },
    }
  }

  // Listeners added once read the newest of these.
  const live = useRef({ follow, finish, down, scale })
  live.current = { follow, finish, down, scale }

  useEffect(() => () => pressed.current?.detach(), [])

  useEffect(() => {
    if (!frame) return
    const attach = () => {
      const doc = frame.contentDocument
      if (!doc) return () => {}
      const onDown = (event: PointerEvent) => live.current.down(event)
      // A menu item is a link: the browser's own link dragging would take the press.
      const onNativeDrag = (event: DragEvent) => {
        if ((event.target as Element | null)?.closest?.('[data-qb-menu]')) event.preventDefault()
      }
      doc.addEventListener('pointerdown', onDown)
      doc.addEventListener('dragstart', onNativeDrag, true)
      return () => {
        doc.removeEventListener('pointerdown', onDown)
        doc.removeEventListener('dragstart', onNativeDrag, true)
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
  }, [frame])

  return view
}

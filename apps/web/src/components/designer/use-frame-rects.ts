import { useEffect, useRef, useState } from 'react'
import { toLayerRect, type Rect } from '@/lib/shared/design/layer-geometry'

/** A menu item's key among the frame's boxes, beside the blocks' own. */
export const menuKey = (target: string) => `menu:${target}`
/** The menu's row of items. */
export const MENU_ROW_KEY = 'menu-row'

/** Whether the page lays an element out, as the menu's copy for another width is not. */
const drawn = (element: Element) => element.getClientRects().length > 0

/**
 * The element a key marks in the frame's page, if the page draws it: a block
 * by its section, a menu item (`menu:<item>`) or the menu's row. The menu is
 * drawn once per width, so the one laid out is the one meant.
 */
export function blockElement(
  doc: Document,
  key: string,
  locate?: (doc: Document, key: string) => Element | null
): Element | null {
  if (locate && /^(el|flash):/.test(key)) return locate(doc, key)
  if (key === MENU_ROW_KEY)
    return [...doc.querySelectorAll('[data-qb-menu-row]')].find(drawn) ?? null
  if (key.startsWith('menu:')) {
    const target = key.slice('menu:'.length)
    return (
      [...doc.querySelectorAll('[data-qb-menu]')].find(
        (element) => element.getAttribute('data-qb-menu') === target && drawn(element)
      ) ?? null
    )
  }
  for (const element of doc.querySelectorAll('[data-qb-section]'))
    if (element.getAttribute('data-qb-section') === key) return element
  return null
}

/**
 * Where an element is drawn: its own box, or for the menu's row the box its
 * items fill, since the row itself can stretch across the header.
 */
function boxOf(key: string, element: Element): Rect {
  const own = element.getBoundingClientRect()
  if (key !== MENU_ROW_KEY) return own
  const items = [...element.querySelectorAll('[data-qb-menu]')]
    .filter(drawn)
    .map((item) => item.getBoundingClientRect())
  if (!items.length) return own
  const left = Math.min(...items.map((box) => box.left))
  const top = Math.min(...items.map((box) => box.top))
  const right = Math.max(...items.map((box) => box.right))
  const bottom = Math.max(...items.map((box) => box.bottom))
  return { left, top, width: right - left, height: bottom - top }
}

/** How a menu item's words are set in the frame, so a field over them matches. */
export function menuItemFont(
  frame: HTMLIFrameElement | null,
  target: string
): { size: number; weight: string; family: string } | null {
  const doc = frame?.contentDocument
  const element = doc ? blockElement(doc, menuKey(target)) : null
  const view = doc?.defaultView
  if (!element || !view) return null
  const style = view.getComputedStyle(element)
  return {
    size: Number.parseFloat(style.fontSize) || 14,
    weight: style.fontWeight,
    family: style.fontFamily,
  }
}

const sameRect = (a: Rect | undefined, b: Rect | undefined) =>
  !!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height

/**
 * Where blocks are drawn in the canvas frame, on the editing layer over it.
 * The frame is the same origin, so their boxes are read straight from its
 * page and read again whenever they may have moved: the page or a block
 * changes size, the page changes, scrolls or resizes (a device width), or
 * the scale changes. Reads are batched to one per frame.
 */
export function useFrameRects(
  frame: HTMLIFrameElement | null,
  scale: number,
  keys: readonly (string | null)[],
  /** Finds an element picked in a block (`el:` keys) or a change outlined (`flash:` keys). */
  locate?: (doc: Document, key: string) => Element | null
): Partial<Record<string, Rect>> {
  const locating = useRef(locate)
  locating.current = locate
  const [rects, setRects] = useState<Partial<Record<string, Rect>>>({})
  const wanted = keys.filter((key): key is string => !!key)
  const signature = [...new Set(wanted)].join('\n')

  useEffect(() => {
    const list = signature ? signature.split('\n') : []
    if (!frame || !list.length) {
      setRects((before) => (Object.keys(before).length ? {} : before))
      return
    }
    let raf = 0
    let resize: ResizeObserver | null = null
    let watching: Element[] = []
    let detach = () => {}

    function measure() {
      raf = 0
      const doc = frame?.contentDocument
      if (!doc) return
      const found = list.map((key) => [key, blockElement(doc, key, locating.current)] as const)
      // Blocks the page drew afresh are watched in place of the ones they replaced.
      const elements = found.flatMap(([, element]) => (element ? [element] : []))
      const moved =
        elements.length !== watching.length ||
        elements.some((element, i) => element !== watching[i])
      if (moved) {
        for (const element of watching) resize?.unobserve(element)
        for (const element of elements) resize?.observe(element)
        watching = elements
      }
      const next: Partial<Record<string, Rect>> = {}
      for (const [key, element] of found)
        if (element) next[key] = toLayerRect(boxOf(key, element), scale)
      setRects((before) => {
        const keysBefore = Object.keys(before)
        const same =
          keysBefore.length === Object.keys(next).length &&
          keysBefore.every((key) => sameRect(before[key], next[key]))
        return same ? before : next
      })
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    function attach() {
      detach()
      const doc = frame?.contentDocument
      const win = frame?.contentWindow as (Window & typeof globalThis) | null | undefined
      if (!doc || !win) return
      // The frame's own observers, so they watch its page as it lays it out.
      resize = new (win.ResizeObserver ?? ResizeObserver)(schedule)
      resize.observe(doc.documentElement)
      watching = []
      const mutation = new (win.MutationObserver ?? MutationObserver)(schedule)
      mutation.observe(doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      })
      win.addEventListener('scroll', schedule, true)
      win.addEventListener('resize', schedule)
      schedule()
      detach = () => {
        resize?.disconnect()
        resize = null
        mutation.disconnect()
        win.removeEventListener('scroll', schedule, true)
        win.removeEventListener('resize', schedule)
      }
    }
    // A page loaded afresh in the frame is a new document to watch.
    frame.addEventListener('load', attach)
    attach()
    return () => {
      cancelAnimationFrame(raf)
      frame.removeEventListener('load', attach)
      detach()
    }
  }, [frame, scale, signature])

  return rects
}

/** Scrolls the frame's page, and only it, so a block picked elsewhere is in view. */
export function revealInFrame(frame: HTMLIFrameElement | null, key: string | null): void {
  const doc = frame?.contentDocument
  const win = frame?.contentWindow
  if (!doc || !win || !key) return
  const box = blockElement(doc, key)?.getBoundingClientRect()
  if (!box || (box.bottom > 0 && box.top < win.innerHeight)) return
  win.scrollTo({
    top: win.scrollY + box.top - Math.max(0, (win.innerHeight - box.height) / 2),
    behavior: win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
}

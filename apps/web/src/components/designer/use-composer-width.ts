import { useEffect, useRef, useState } from 'react'
import {
  COMPOSER_WIDTH_NAMES,
  composerSetting,
  composerWidthKey,
  composerWidthMeasures,
  composerWidthOf,
  snapComposerWidth,
  stepComposerWidth,
  writeComposerWidth,
  type ComposerKey,
  type ComposerWidth,
} from '@/lib/shared/design/composer-width'
import { pickOfKey } from '@/lib/shared/design/element-pick'
import { toLayerRect, type Rect } from '@/lib/shared/design/layer-geometry'
import { composerInHero } from '@/lib/shared/design/main-action'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { swallowClick, type GridEditing } from './use-grid-edit'

/** Which edge a drag holds. */
export type ComposerEdge = 'left' | 'right'

/** What the layer draws while the composer is dragged, on the layer. */
export interface ComposerDragView {
  edge: ComposerEdge
  /** The composer as the pointer holds it. */
  lifted: Rect
  /** The width it snaps to. */
  ghost: Rect
}

/** The part the composer in the hero is, as the canvas picks it. */
const COMPOSER_PART = 'hero.home.composer'
/** From this width up the composer takes its step; phones always run it full. */
const DESKTOP = 640
/** How far the pointer goes before a press becomes a drag, in px. */
const THRESHOLD = 4
/** The narrowest the held composer shows, in px on the frame. */
const LEAST = 48
/** Fields where keys belong to what is typed. */
const TYPING = '[data-qb-words-editing], input, textarea, select, [contenteditable="true"]'
const NAME = 'Composer'

interface Measure {
  /** The composer's box in the frame. */
  box: Rect
  /** The words' width it keeps within, in the frame's px. */
  room: number
  measures: Array<{ step: ComposerWidth; px: number }>
}

interface Drag extends Measure {
  edge: ComposerEdge
  startX: number
  centred: boolean
  /** The stored width when the drag began, put back on Escape. */
  stored: PortalDesign['pages']['home']['composerWidth']
  drawn: ComposerWidth
  landed: ComposerWidth
  began: boolean
  detach: () => void
}

const wrapperOf = (doc: Document | null | undefined) =>
  doc?.querySelector<HTMLElement>('[data-qb-section=hero] [data-qb-band-composer]') ?? null

/** The composer's box, the words' width around it and each step's width, from the page. */
function measure(doc: Document | null | undefined): Measure | null {
  const wrapper = wrapperOf(doc)
  const view = doc?.defaultView
  const words = wrapper?.parentElement
  if (!wrapper || !view || !words) return null
  const px = (value: string) => Number.parseFloat(value) || 0
  const style = view.getComputedStyle(words)
  const room = words.getBoundingClientRect().width - px(style.paddingLeft) - px(style.paddingRight)
  const rem = px(view.getComputedStyle(doc.documentElement).fontSize) || 16
  const r = wrapper.getBoundingClientRect()
  return {
    box: { left: r.left, top: r.top, width: r.width, height: r.height },
    room,
    measures: composerWidthMeasures(room, rem),
  }
}

/**
 * Resizing Home's composer in the hero on the canvas, as Home's blocks
 * resize: by dragging its right edge (and with centred words its left, as it
 * grows on both sides), snapping to the width steps, or with Shift and Left
 * or Right. A drag is one step to undo, and each change is said aloud. Only
 * on a desktop-wide canvas, as phones always give it the full width.
 */
export function useComposerWidthEdit({
  frame,
  scale,
  picked,
  editing,
}: {
  frame: HTMLIFrameElement | null
  scale: number
  /** The element picked on the canvas, by pick key. */
  picked: string | null
  editing?: GridEditing
}) {
  const [view, setView] = useState<ComposerDragView | null>(null)
  const dragging = useRef<Drag | null>(null)
  const pick = picked ? pickOfKey(picked) : null
  const inBand =
    !!editing && pick?.part === COMPOSER_PART && composerInHero(editing.design.pages.home)
  const page = () => frame?.contentDocument ?? null
  const desktop = () => (frame?.contentWindow?.innerWidth ?? 0) >= DESKTOP
  const found = inBand ? measure(page()) : null
  const centred = !!editing && composerSetting(editing.design).centred

  /** The composer at a width in the frame's px, about its start box, on the layer. */
  const boxAt = (drag: Drag, width: number): Rect => {
    const { box } = drag
    const left = drag.centred ? box.left + (box.width - width) / 2 : box.left
    return toLayerRect({ left, top: box.top, width, height: box.height }, scale)
  }

  function write(width: ComposerWidth | undefined) {
    editing?.update((draft) => {
      if (width) writeComposerWidth(draft, width)
      else delete draft.pages.home.composerWidth
    })
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
    swallowClick(frame?.contentWindow)
    if (cancel) {
      editing.update((draft) => {
        if (drag.stored) draft.pages.home.composerWidth = drag.stored
        else delete draft.pages.home.composerWidth
      })
      editing.end()
      editing.say('Composer width put back.')
      return
    }
    editing.end()
    if (drag.landed !== drag.drawn)
      editing.say(`Composer width: ${COMPOSER_WIDTH_NAMES[drag.landed]}.`)
  }

  /** Follows the pointer, at a point in the builder's viewport. */
  function follow(x: number) {
    const drag = dragging.current
    if (!drag || !editing) return
    const dx = (x - drag.startX) / scale
    if (!drag.began) {
      if (Math.abs(dx) < THRESHOLD) return
      drag.began = true
      editing.begin(`Resize ${NAME}`)
      const doc = page()
      doc?.getSelection()?.removeAllRanges()
      if (doc) doc.documentElement.style.userSelect = 'none'
    }
    const grow = (drag.edge === 'right' ? dx : -dx) * (drag.centred ? 2 : 1)
    const wanted = Math.min(drag.room, Math.max(LEAST, drag.box.width + grow))
    const step = snapComposerWidth(wanted, drag.measures, drag.landed)
    if (step !== drag.landed) {
      drag.landed = step
      write(step)
    }
    const snapped = drag.measures.find((m) => m.step === step)!.px
    setView({ edge: drag.edge, lifted: boxAt(drag, wanted), ghost: boxAt(drag, snapped) })
  }

  /** Starts a press that may become a drag, at a point in the builder's viewport. */
  function press(edge: ComposerEdge, x: number): boolean {
    const doc = page()
    if (!editing || !inBand || !doc || !frame || dragging.current || !desktop()) return false
    const now = measure(doc)
    if (!now) return false
    const onMove = (event: PointerEvent) => live.current.follow(event.clientX)
    const onFrameMove = (event: PointerEvent) =>
      live.current.follow(frame.getBoundingClientRect().left + event.clientX * live.current.scale)
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
    const drawn = composerWidthOf(editing.design)
    dragging.current = {
      ...now,
      edge,
      startX: x,
      centred,
      stored: editing.design.pages.home.composerWidth,
      drawn,
      landed: drawn,
      began: false,
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

  /** One keyboard step; true when the key was the composer's. */
  function step(event: ComposerKey): boolean {
    const way = composerWidthKey(event)
    if (!way || !editing || !inBand || dragging.current) return false
    if (!desktop()) {
      editing.say('Phones always give the composer the full width.')
      return true
    }
    const now = measure(page())
    if (!now) return false
    const next = stepComposerWidth(composerWidthOf(editing.design), way, now.measures)
    if (!next) {
      editing.say(`The composer is as ${way === 'wider' ? 'wide' : 'narrow'} as it goes.`)
      return true
    }
    editing.update((draft) => writeComposerWidth(draft, next), `Resize ${NAME}`)
    editing.say(`Composer width: ${COMPOSER_WIDTH_NAMES[next]}.`)
    return true
  }

  // Listeners added once read the newest of these.
  const live = useRef({ follow, finish, step, scale })
  live.current = { follow, finish, step, scale }

  useEffect(() => () => dragging.current?.detach(), [])

  // With the composer picked, Shift and the arrows work where focus rests: the page, its tag, or nothing.
  useEffect(() => {
    if (!inBand || !frame) return
    const attach = () => {
      const doc = frame.contentDocument
      const onKey = (event: KeyboardEvent) => {
        const target = event.target as Element | null
        const inPage = target?.ownerDocument === doc
        const resting =
          target === document.body ||
          target === doc?.body ||
          !!target?.closest?.('[data-element-tag]')
        if (event.defaultPrevented || !(resting || inPage) || target?.closest?.(TYPING)) return
        if (live.current.step(event)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      window.addEventListener('keydown', onKey)
      if (doc && doc !== document) doc.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('keydown', onKey)
        if (doc && doc !== document) doc.removeEventListener('keydown', onKey)
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
  }, [inBand, frame])

  return {
    /** Whether the composer in the hero is picked on a desktop-wide canvas, so its handles show. */
    on: inBand && !!found && desktop(),
    /** The composer's box on the layer. */
    box: found ? toLayerRect(found.box, scale) : null,
    centred,
    view,
    /** Starts a drag from a handle on the layer. */
    start: (edge: ComposerEdge, event: { clientX: number; button: number }) => {
      if (event.button === 0) press(edge, event.clientX)
    },
  }
}

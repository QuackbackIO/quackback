import { useEffect, useRef } from 'react'
import {
  blockKey,
  locationOfPath,
  type DesignerPage,
  type Selection,
} from '@/lib/shared/design/outline'
import type { CanvasFrame } from './designer-canvas'
import { EditingLayer } from './editing-layer'
import { ComposerWidthHandles } from './composer-width-handles'
import { GridHandles } from './grid-handles'
import { useComposerWidthEdit } from './use-composer-width'
import { useGridEdit, type GridEditing } from './use-grid-edit'
import { MENU_ROW_KEY, revealInFrame, useFrameRects } from './use-frame-rects'
import { ElementOutlines, type OutlinedElement } from './element-outline'
import { locateTarget, outlineTargets } from './change-outlines'
import type { ChangeFlash } from './use-change-flash'
import {
  locatePick,
  pickKey,
  pickName,
  pickOfKey,
  picksIn,
  pickTraits,
  type ElementPick,
} from '@/lib/shared/design/element-pick'
import { destinationName } from '@/lib/shared/design/content-kinds'
import { overlaps } from '@/lib/shared/design/layer-geometry'
import { CHIP_NAME, keepFocus } from './settings-focus'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { OverridePage } from '@/lib/shared/design/style-overrides'
import type { StyleState } from '@/lib/shared/design/style-tokens'

/**
 * The editing layer over the canvas, drawn from where the frame's page puts
 * the blocks under the pointer and picked. A block picked elsewhere, such as
 * in the panel, is scrolled into view in the frame. Escape lets go of the
 * pick even when nothing has focus, as after the focused chip button goes.
 * A picked Home block on the grid takes a grip and resize handles, and the
 * composer picked in Home's hero takes width handles. Open sits on the
 * picked link's or item's own tag, never on the block's chip.
 */
export function CanvasLayer({
  canvas,
  hovered,
  picked,
  name,
  homeOn,
  pages,
  onPage,
  onDuplicate,
  onRemove,
  onMove,
  onDeselect,
  grid,
  elements,
  flash = null,
}: {
  canvas: CanvasFrame
  hovered: Selection | null
  picked: Selection | null
  /** The picked block's name. */
  name: string | null
  homeOn: boolean
  /** The pages the builder draws, which Open can go to. */
  pages: readonly DesignerPage[]
  onPage: (page: DesignerPage, item?: string | null) => void
  onDuplicate: (key: Selection) => void
  onRemove: (key: Selection) => void
  /** Moves a block a place up or down, as its ⋯ does. */
  onMove?: (key: Selection, by: -1 | 1) => void
  onDeselect: () => void
  /** What moving and resizing Home's blocks needs; without it, blocks stay put. */
  grid?: GridEditing
  /** Elements in blocks: the one pointed at and the one picked, by pick key. */
  elements?: {
    design: PortalDesign
    page: OverridePage | null
    hovered: string | null
    picked: string | null
    /** The state the picked element is drawn in, so its look in that state shows. */
    force: StyleState
    onPick: (pick: ElementPick | null) => void
    say: (words: string) => void
  }
  /** What a change touched, outlined for a moment, its elements in the state it changed. */
  flash?: ChangeFlash | null
}) {
  const doc = canvas.frame?.contentDocument ?? null
  // What the change outlines, found in the page as drawn now.
  const changedTargets = flash && doc ? outlineTargets(doc, flash.spots) : []
  const flashKeys = changedTargets.map((_, at) => `flash:${flash!.seq}:${at}`)
  const flashTargetOf = (key: string) => {
    const m = /^flash:\d+:(\d+)$/.exec(key)
    return m ? changedTargets[Number(m[1])] : undefined
  }
  const locate = (doc: Document, key: string) => {
    if (key.startsWith('flash:')) {
      const target = flashTargetOf(key)
      return target ? locateTarget(doc, target) : null
    }
    const pick = pickOfKey(key)
    return pick && elements ? locatePick(doc, pick, elements.design, elements.page) : null
  }
  const element = elements?.picked ? pickOfKey(elements.picked) : null
  const pointed = elements?.hovered ? pickOfKey(elements.hovered) : null
  const traitsOf = (pick: ElementPick | null) =>
    pick && elements && doc ? pickTraits(doc, pick, elements.design, elements.page) : null
  const pickedTraits = traitsOf(element)
  const pointedTraits = traitsOf(pointed)
  // A data item styles every item of its kind in its block: each is outlined.
  const otherKeys =
    element && pickedTraits
      ? pickedTraits.others.map((index) => pickKey({ ...element, index }))
      : []
  const rects = useFrameRects(
    canvas.frame,
    canvas.scale,
    [
      hovered,
      picked,
      elements?.hovered ?? null,
      elements?.picked ?? null,
      ...otherKeys,
      ...flashKeys,
      // The menu's items, which the chip of something small beside them, such as the logo, keeps clear of.
      picked ? MENU_ROW_KEY : null,
    ],
    locate
  )
  const nameOf = (pick: ElementPick | null) =>
    pick && elements ? pickName(pick, elements.design, elements.page) : null
  const locateRef = useRef(locate)
  locateRef.current = locate
  // A style changed in a state shows in it while outlined: its elements are forced into it.
  const forcedFlash = changedTargets.flatMap((target, at) =>
    target.state && rects[flashKeys[at]!] ? [`${flashKeys[at]}|${target.state}`] : []
  )
  const forcedFlashKey = forcedFlash.join(' ')
  useEffect(() => {
    const doc = canvas.frame?.contentDocument
    if (!doc || !forcedFlashKey) return
    const set: Element[] = []
    for (const entry of forcedFlashKey.split(' ')) {
      const [key, state] = entry.split('|')
      const node = locateRef.current(doc, key!)
      if (!node || node.hasAttribute('data-qb-force')) continue
      node.setAttribute('data-qb-force', state!)
      set.push(node)
    }
    return () => {
      for (const node of set) node.removeAttribute('data-qb-force')
    }
  }, [canvas.frame, forcedFlashKey])
  // The picked element is drawn in the state its settings show.
  const force = elements?.force ?? 'base'
  const forcedKey = elements?.picked ?? null
  const forcedRect = forcedKey ? rects[forcedKey] : undefined
  useEffect(() => {
    const doc = canvas.frame?.contentDocument
    if (!doc || !forcedKey || force === 'base') return
    const node = locateRef.current(doc, forcedKey)
    if (!node) return
    node.setAttribute('data-qb-force', force)
    return () => node.removeAttribute('data-qb-force')
  }, [canvas.frame, forcedKey, force, forcedRect])
  const step = (to: 'next' | 'previous' | 'up') => {
    if (!elements || !element) return
    if (to === 'up') {
      elements.onPick(null)
      keepFocus(CHIP_NAME)
      return
    }
    const doc = canvas.frame?.contentDocument
    if (!doc || !element.section) return
    const all = picksIn(doc, element.section, elements.design, elements.page)
    if (!all.length) return
    const at = all.findIndex((p) => pickKey(p) === pickKey(element))
    const next = all[(at + (to === 'next' ? 1 : -1) + all.length) % all.length]!
    elements.onPick(next)
    elements.say(`${nameOf(next)} selected.`)
    keepFocus('[data-editing-layer] [data-element-tag]')
  }
  const down = () => {
    const doc = canvas.frame?.contentDocument
    if (!doc || !elements || !picked) return
    const first = picksIn(doc, picked, elements.design, elements.page)[0]
    if (!first) return
    elements.onPick(first)
    elements.say(`${nameOf(first)} selected.`)
    keepFocus('[data-editing-layer] [data-element-tag]')
  }
  const gridEdit = useGridEdit({
    frame: canvas.frame,
    scale: canvas.scale,
    room: canvas.room,
    picked,
    name,
    editing: grid,
  })
  const composerWidth = useComposerWidthEdit({
    frame: canvas.frame,
    scale: canvas.scale,
    picked: elements?.picked ?? null,
    editing: grid,
  })
  const resizing = !!gridEdit.view || !!composerWidth.view
  useEffect(() => revealInFrame(canvas.frame, picked), [canvas.frame, picked])
  const deselect = useRef(onDeselect)
  deselect.current = onDeselect
  useEffect(() => {
    if (!picked) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && event.target === document.body)
        deselect.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked])
  // The picked link or item opens where it goes, if the builder draws that page.
  const at = pickedTraits?.link ? locationOfPath(pickedTraits.link, homeOn) : null
  const opens = at && pages.includes(at.page) ? at : null
  const outlined = (
    pick: ElementPick | null,
    traits: ReturnType<typeof traitsOf>,
    rect: (typeof rects)[string] | null
  ): OutlinedElement | null =>
    pick && traits && rect
      ? {
          rect,
          name: nameOf(pick) ?? '',
          kind: traits.kind,
          editable: traits.editable,
          count: traits.count,
        }
      : null
  const block = picked?.startsWith('block-') ? picked : null
  const homeBlocks = (elements?.design ?? grid?.design)?.pages.home.blocks ?? []
  const placeAt = block ? homeBlocks.findIndex((each, i) => blockKey(each, i) === block) : -1
  const pickedRect = picked ? (rects[picked] ?? null) : null
  const menuRow = picked ? rects[MENU_ROW_KEY] : undefined
  const pointedRect =
    elements?.hovered && elements.hovered !== elements.picked && !resizing
      ? (rects[elements.hovered] ?? null)
      : null
  return (
    <EditingLayer
      room={canvas.room}
      hovered={
        hovered && hovered !== picked && !resizing && !pointedRect ? (rects[hovered] ?? null) : null
      }
      picked={pickedRect}
      pickedKey={picked}
      avoid={menuRow && pickedRect && !overlaps(menuRow, pickedRect) ? [menuRow] : []}
      changed={
        flash
          ? {
              seq: flash.seq,
              rects: flashKeys.flatMap((key) => (rects[key] ? [rects[key]] : [])),
            }
          : null
      }
      name={name}
      onDuplicate={block ? () => onDuplicate(block) : undefined}
      onRemove={block ? () => onRemove(block) : undefined}
      onMove={
        block && onMove && placeAt >= 0
          ? {
              up: placeAt > 0 ? () => onMove(block, -1) : null,
              down: placeAt < homeBlocks.length - 1 ? () => onMove(block, 1) : null,
            }
          : undefined
      }
      onSettings={() => document.getElementById('designer-settings')?.focus()}
      onDown={elements ? down : undefined}
      grip={
        gridEdit.on
          ? {
              onPointerDown: (event) => gridEdit.start('move', event),
              onKeyDown: (event) => {
                if (gridEdit.step(event)) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              },
            }
          : undefined
      }
    >
      {elements && (
        <ElementOutlines
          room={canvas.room}
          hovered={outlined(pointed, pointedTraits, pointedRect)}
          picked={outlined(
            element,
            pickedTraits,
            elements.picked && !resizing ? (rects[elements.picked] ?? null) : null
          )}
          others={resizing ? [] : otherKeys.flatMap((key) => (rects[key] ? [rects[key]] : []))}
          open={
            opens
              ? {
                  label: `Open ${destinationName(opens)}`,
                  onOpen: () => onPage(opens.page, opens.item),
                }
              : null
          }
          block={pickedRect}
          onStep={step}
        />
      )}
      {composerWidth.on && composerWidth.box && (
        <ComposerWidthHandles
          box={composerWidth.box}
          centred={composerWidth.centred}
          view={composerWidth.view}
          onStart={(edge, event) => composerWidth.start(edge, event)}
        />
      )}
      {gridEdit.on && (
        <GridHandles
          picked={pickedRect}
          view={gridEdit.view}
          onStart={(edge, event) => gridEdit.start(edge, event)}
        />
      )}
    </EditingLayer>
  )
}

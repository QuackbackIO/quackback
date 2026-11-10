/**
 * The element under the pointer and the element picked in a block, drawn on
 * the editing layer in the colours of their kind of content: static words in
 * dashed blue, the workspace's data in teal, the product's own interface in
 * dotted slate. A quiet outline and a tag while pointing; a firmer outline
 * and a tag once picked, and for a data item a lighter one on every other
 * item it styles. A tag names the element and where it is, "Headline ·
 * Hero"; a database glyph marks the workspace's own content. The tag takes
 * the keyboard: Tab and Shift+Tab move between the block's elements, Up
 * arrow and Escape go back to the block, Right arrow reaches its Open.
 */
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { ArrowTopRightOnSquareIcon, CircleStackIcon } from '@heroicons/react/16/solid'
import { KIND_LOOK, type ContentKind } from '@/lib/shared/design/content-kinds'
import { outlineBox, type Rect } from '@/lib/shared/design/layer-geometry'

/** An element as the layer draws it: where it is, its name and its kind of content. */
export interface OutlinedElement {
  rect: Rect
  /** What it is and where: "Headline · Hero". */
  name: string
  kind: ContentKind
  /** Whether a double-click edits its words where they sit. */
  editable: boolean
  /** How many it styles: every item of its kind, for a data item. */
  count?: number
}

/** What a screen reader hears after the element's name, where there is more to say. */
function spoken({ kind, editable, count = 1 }: OutlinedElement): string {
  if (kind === 'dynamic') return `, your data${count > 1 ? `, styling all ${count}` : ''}`
  return editable ? ', double-click to edit in place' : ''
}

const TAG =
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white'

/** How far below its block's top an element's tag would meet the block's chip. */
const UNDER_CHIP = 34

function Tag({
  rect,
  room,
  block,
  children,
}: {
  rect: Rect
  room: { width: number; height: number }
  /** The block it is in, whose chip sits on its top edge: a tag there goes below instead. */
  block?: Rect | null
  children: ReactNode
}) {
  const underChip = !!block && rect.top - block.top < UNDER_CHIP
  const above = rect.top > 22 && !underChip
  const left = Math.max(4, Math.min(rect.left, room.width - 220))
  const top = above ? rect.top - 20 : Math.min(rect.top + rect.height + 2, room.height - 20)
  return (
    <div className="absolute flex items-center gap-1" style={{ left, top }}>
      {children}
    </div>
  )
}

/** The tag's words: its name, after a database glyph for the workspace's own content. */
function TagWords({ name, kind }: Pick<OutlinedElement, 'name' | 'kind'>) {
  return (
    <>
      {kind === 'dynamic' && (
        <CircleStackIcon data-content-glyph="" className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="max-w-48 truncate">{name}</span>
    </>
  )
}

/** An outline in its kind's colour and dash, edged in white so it reads on any brand colour. */
function outlineStyle(kind: ContentKind, width: number, quiet = false) {
  const look = KIND_LOOK[kind]
  return {
    outline: `${width}px ${look.dash} ${look.outline}`,
    boxShadow: quiet ? undefined : '0 0 0 1px #fff',
  }
}

export function ElementOutlines({
  room,
  hovered,
  picked,
  others = [],
  open,
  block = null,
  onStep,
}: {
  room: { width: number; height: number }
  hovered: OutlinedElement | null
  picked: OutlinedElement | null
  /** The other items a picked data item styles too. */
  others?: readonly Rect[]
  /** Where the picked link or item goes, for its Open: "Open post". */
  open?: { label: string; onOpen: () => void } | null
  /** The picked block, whose chip the tags keep clear of. */
  block?: Rect | null
  /** Moves the pick: to the next or the last element in the block, or up to the block. */
  onStep: (to: 'next' | 'previous' | 'up') => void
}) {
  const focusIn = (selector: string) =>
    document.querySelector<HTMLElement>(`[data-editing-layer] ${selector}`)?.focus()
  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowRight' && !event.shiftKey && open) {
      event.preventDefault()
      event.stopPropagation()
      focusIn('[data-element-open]')
      return
    }
    const to =
      event.key === 'Tab'
        ? event.shiftKey
          ? 'previous'
          : 'next'
        : event.key === 'ArrowUp' || event.key === 'Escape'
          ? 'up'
          : null
    if (!to) return
    event.preventDefault()
    event.stopPropagation()
    onStep(to)
  }
  const onOpenKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      focusIn('[data-element-tag]')
    } else if (event.key === 'ArrowUp' || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onStep('up')
    }
  }
  return (
    <>
      {hovered && (
        <>
          <div
            data-element-hover=""
            data-kind={hovered.kind}
            aria-hidden="true"
            className="absolute rounded-[2px]"
            style={{ ...outlineBox(hovered.rect, 1, room), ...outlineStyle(hovered.kind, 1) }}
          />
          <Tag rect={hovered.rect} room={room} block={block}>
            <span
              aria-hidden="true"
              data-element-hover-tag=""
              className={TAG}
              style={{ background: KIND_LOOK[hovered.kind].chip }}
            >
              <TagWords name={hovered.name} kind={hovered.kind} />
            </span>
          </Tag>
        </>
      )}
      {picked &&
        others.map((rect, i) => (
          <div
            key={i}
            data-element-also=""
            aria-hidden="true"
            className="absolute rounded-[2px] opacity-60"
            style={{ ...outlineBox(rect, 1, room), ...outlineStyle(picked.kind, 1, true) }}
          />
        ))}
      {picked && (
        <>
          <div
            data-element-picked=""
            data-kind={picked.kind}
            aria-hidden="true"
            className="absolute rounded-[2px]"
            style={{ ...outlineBox(picked.rect, 1, room), ...outlineStyle(picked.kind, 2) }}
          />
          <Tag rect={picked.rect} room={room} block={block}>
            <button
              type="button"
              data-element-tag=""
              aria-label={`${picked.name}${spoken(picked)}, picked. Tab moves to the next element, Up arrow to its block${open ? `, Right arrow to ${open.label}` : ''}`}
              aria-keyshortcuts={`Tab Shift+Tab ArrowUp Escape${open ? ' ArrowRight' : ''}`}
              onKeyDown={onKey}
              className={`pointer-events-auto ${TAG} focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:outline-none`}
              style={{ background: KIND_LOOK[picked.kind].chip }}
            >
              <TagWords name={picked.name} kind={picked.kind} />
            </button>
            {open && (
              <button
                type="button"
                data-element-open=""
                title="Ctrl or Cmd and click follows a link on the canvas too"
                aria-keyshortcuts="ArrowLeft ArrowUp Escape"
                onKeyDown={onOpenKey}
                onClick={open.onOpen}
                className={`pointer-events-auto ${TAG} hover:brightness-110 focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:outline-none`}
                style={{ background: KIND_LOOK[picked.kind].chip }}
              >
                <ArrowTopRightOnSquareIcon className="size-3" aria-hidden="true" />
                {open.label}
              </button>
            )}
          </Tag>
        </>
      )}
    </>
  )
}

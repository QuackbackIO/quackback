/**
 * The element under the pointer and the element picked in a block, drawn on
 * the editing layer in the colours of their kind of content: static words in
 * dashed blue, the workspace's data in teal, the product's own interface in
 * dotted slate with a lock. A quiet outline and a tag while pointing; a
 * firmer outline and a tag once picked, and for a data item a lighter one on
 * every other item it styles. The tag takes the keyboard: Tab and Shift+Tab
 * move between the block's elements, Up arrow and Escape go back to the
 * block, Right arrow reaches its Open. Live values in the block wear a small
 * Live badge that says where they come from and where they are changed.
 */
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ArrowTopRightOnSquareIcon, LockClosedIcon } from '@heroicons/react/16/solid'
import { KIND_LOOK, type ContentKind } from '@/lib/shared/design/content-kinds'
import { outlineBox, type Rect } from '@/lib/shared/design/layer-geometry'

/** An element as the layer draws it: where it is, its name and what its kind says. */
export interface OutlinedElement {
  rect: Rect
  name: string
  kind: ContentKind
  /** What the tag says of its kind: "Static · edit in place", "styling all 3", "style only". */
  note: string
}

/** A live value in the picked or pointed block. */
export interface LiveValue {
  rect: Rect
  /** Said after "From your". */
  source: string
  /** The settings page it is changed on. */
  settings: string
  /** Whether the box is the value's words, so the badge follows them, rather than a box it sits on the corner of. */
  words: boolean
}

/** How a kind is said to a screen reader, after the element's name. */
function spoken(kind: ContentKind, note: string): string {
  if (kind === 'static')
    return note.includes('edit in place')
      ? 'static words, double-click to edit in place'
      : 'static, part of the design'
  if (kind === 'dynamic') return `your data, ${note === 'Dynamic' ? 'styled here' : note}`
  return 'product interface, style only'
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

/** The tag's words: its name, and its kind's note. */
function TagWords({ name, kind, note }: Pick<OutlinedElement, 'name' | 'kind' | 'note'>) {
  return (
    <>
      <span className="max-w-48 truncate">{name}</span>
      <span
        data-kind-note={kind}
        className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-1.5 text-[11px]"
      >
        {kind === 'system' && <LockClosedIcon className="size-2.5" aria-hidden="true" />}
        {note}
      </span>
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
  lives = [],
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
  /** Live values shown in the block picked or pointed at. */
  lives?: readonly LiveValue[]
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
      {/* Under the tags, which name what is pointed at or picked. */}
      {lives.map((live, i) => (
        <LiveBadge key={i} live={live} room={room} />
      ))}
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
              <TagWords {...hovered} />
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
              aria-label={`${picked.name}, ${spoken(picked.kind, picked.note)}, picked. Tab moves to the next element, Up arrow to its block${open ? `, Right arrow to ${open.label}` : ''}`}
              aria-keyshortcuts={`Tab Shift+Tab ArrowUp Escape${open ? ' ArrowRight' : ''}`}
              onKeyDown={onKey}
              className={`pointer-events-auto ${TAG} focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:outline-none`}
              style={{ background: KIND_LOOK[picked.kind].chip }}
            >
              <TagWords {...picked} />
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

/**
 * A live value's badge, after its words or on its box's top end corner: "Live", and on hover or focus where the
 * value comes from, with a way to the settings it is changed in.
 */
function LiveBadge({ live, room }: { live: LiveValue; room: { width: number; height: number } }) {
  const [open, setOpen] = useState(false)
  // On the value's top end corner, as a badge on what it marks, clear of what follows it.
  const end = live.rect.left + live.rect.width
  const left = Math.max(4, Math.min(live.words ? end + 6 : end - 6, room.width - 44))
  const top = Math.max(
    2,
    live.words ? live.rect.top + live.rect.height / 2 - 9 : live.rect.top - 11
  )
  return (
    <div
      data-live-badge=""
      className="pointer-events-auto absolute"
      style={{ left, top }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        aria-label={`Live: from your ${live.source}`}
        aria-expanded={open}
        className="rounded-full px-1.5 py-px text-[11px] font-semibold text-white focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:outline-none"
        style={{ background: KIND_LOOK.dynamic.chip, boxShadow: '0 0 0 1px #fff' }}
      >
        Live
      </button>
      {open && (
        <div
          role="note"
          className="absolute top-full left-0 z-10 mt-1 w-max max-w-56 rounded-md border border-border bg-popover px-2 py-1.5 text-[12px] text-popover-foreground shadow-md"
        >
          <span>From your {live.source}. </span>
          <a
            href={live.settings}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
          >
            Change in Settings
          </a>
        </div>
      )}
    </div>
  )
}

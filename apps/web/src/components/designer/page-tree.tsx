import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/16/solid'
import { MENU_COPY } from '@/lib/shared/design/menu-actions'
import { treeRows, type TreeRow } from '@/lib/shared/design/page-tree'
import { cn } from '@/lib/shared/utils'
import { BlockIcon } from './block-icon'
import { WORDS } from './properties/words'

/** Rows that start closed: the menu can be long, and is edited in the header's panel too. */
const CLOSED = new Set(['header'])

const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground'
const iconButton = cn(
  'grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
  ring
)

/** The tree row a builder region focuses, by the row's id. */
export const treeRowSelector = (id: string) => `[data-tree-row="${CSS.escape(id)}"]`

/**
 * The page's parts as a tree: one tab stop, the arrows to move through it,
 * Right and Left to open and close, Enter or a click to pick a part, as a
 * click on the canvas does. A row that can be hidden has an eye; one that can
 * move has Move up and down, and Alt with the arrows. Tab reaches the focused
 * row's own buttons.
 */
export function PageTree({
  label,
  rows,
  onPick,
  onShown,
  onMove,
}: {
  label: string
  rows: readonly TreeRow[]
  onPick: (row: TreeRow) => void
  onShown: (row: TreeRow, shown: boolean) => void
  onMove: (row: TreeRow, by: -1 | 1) => void
}) {
  const id = useId()
  // What is closed, so a part that gains parts later, such as Blocks, shows them.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(CLOSED))
  const open = new Set(
    treeRows(rows).flatMap((row) => (row.children && !closed.has(row.id) ? [row.id] : []))
  )
  const [current, setCurrent] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  // A row moved by the keyboard keeps focus once it is drawn in its new place.
  const refocus = useRef<string | null>(null)

  const shown = treeRows(rows, open)
  const active = shown.find((row) => row.id === current) ?? shown[0]
  const parentOf = (row: TreeRow) =>
    treeRows(rows).find((each) => each.children?.some((child) => child.id === row.id))
  const focusRow = (rowId: string) => {
    setCurrent(rowId)
    list.current?.querySelector<HTMLElement>(treeRowSelector(rowId))?.focus()
  }
  useEffect(() => {
    const rowId = refocus.current
    if (!rowId) return
    refocus.current = null
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(treeRowSelector(rowId))?.focus()
    )
  })
  const toggle = (row: TreeRow, to: boolean) =>
    setClosed((before) => {
      const next = new Set(before)
      if (to) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  const move = (row: TreeRow, by: -1 | 1) => {
    if (!row.move || !(by < 0 ? row.move.up : row.move.down)) return
    refocus.current = row.id
    onMove(row, by)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, row: TreeRow) => {
    // Keys on the row's own buttons are theirs.
    if (event.target !== event.currentTarget) return
    const at = shown.indexOf(row)
    const isOpen = open.has(row.id)
    const go = (to: TreeRow | undefined) => to && focusRow(to.id)
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      return move(row, event.key === 'ArrowUp' ? -1 : 1)
    }
    switch (event.key) {
      case 'ArrowDown':
        go(shown[at + 1])
        break
      case 'ArrowUp':
        go(shown[at - 1])
        break
      case 'Home':
        go(shown[0])
        break
      case 'End':
        go(shown.at(-1))
        break
      case 'ArrowRight':
        if (!row.children) break
        if (isOpen) go(row.children[0])
        else toggle(row, true)
        break
      case 'ArrowLeft':
        if (row.children && isOpen) toggle(row, false)
        else go(parentOf(row))
        break
      case 'Enter':
      case ' ':
        onPick(row)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const draw = (row: TreeRow) => {
    const isOpen = open.has(row.id)
    const focused = row.id === active?.id
    const labelId = `${id}-${row.id}-label`
    const hidden = row.hide && !row.hide.shown
    const stop = focused ? 0 : -1
    return (
      <li
        key={row.id}
        id={`${id}-${row.id}`}
        role="treeitem"
        aria-level={row.level}
        aria-expanded={row.children ? isOpen : undefined}
        aria-labelledby={labelId}
        tabIndex={stop}
        data-tree-row={row.id}
        onFocus={(event) => event.target === event.currentTarget && setCurrent(row.id)}
        onKeyDown={(event) => onKeyDown(event, row)}
        className={cn('group/row rounded-md', ring)}
      >
        <div
          className="flex min-h-7 items-center gap-1 rounded-md pe-1 hover:bg-muted"
          style={{ paddingInlineStart: `${(row.level - 1) * 14 + 2}px` }}
        >
          {row.children ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => toggle(row, !isOpen)}
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <ChevronRightIcon
                className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')}
              />
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <span
            id={labelId}
            onClick={() => {
              focusRow(row.id)
              onPick(row)
            }}
            className={cn(
              'flex min-h-7 min-w-0 flex-1 cursor-default items-center gap-1.5 text-xs',
              hidden && 'text-muted-foreground'
            )}
          >
            {row.blockType && <BlockIcon type={row.blockType} />}
            <span className="truncate">{row.label}</span>
          </span>
          {row.move && (
            <span className="flex opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
              <button
                type="button"
                tabIndex={stop}
                disabled={!row.move.up}
                aria-label={`Move ${row.label} up`}
                onClick={() => move(row, -1)}
                className={iconButton}
              >
                <ArrowUpIcon className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                tabIndex={stop}
                disabled={!row.move.down}
                aria-label={`Move ${row.label} down`}
                onClick={() => move(row, 1)}
                className={iconButton}
              >
                <ArrowDownIcon className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          )}
          {row.hide && (
            <button
              type="button"
              tabIndex={stop}
              disabled={row.hide.shown && row.hide.locked}
              aria-label={`${row.hide.shown ? WORDS.hide : WORDS.show} ${row.label}`}
              title={row.hide.shown && row.hide.locked ? MENU_COPY.landsHere : undefined}
              onClick={() => onShown(row, !row.hide!.shown)}
              className={cn(
                iconButton,
                row.hide.shown &&
                  'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100'
              )}
            >
              {row.hide.shown ? (
                <EyeIcon className="size-3.5" aria-hidden="true" />
              ) : (
                <EyeSlashIcon className="size-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
        {row.children && isOpen && <ul role="group">{row.children.map((child) => draw(child))}</ul>}
      </li>
    )
  }

  return (
    <ul ref={list} role="tree" aria-label={label} className="-mx-1.5">
      {rows.map((row) => draw(row))}
    </ul>
  )
}

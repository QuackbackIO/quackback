/**
 * The one find bar, for every engine that offers find: a field, the match
 * count, previous and next, close. Enter and Shift+Enter step through
 * matches; Escape closes the bar and is marked handled, so the viewer stays
 * open. The engine owns the matching and the highlighting.
 */
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/outline'

const count = new Intl.NumberFormat('en-US')

export function FindBar({
  inputRef,
  label = 'Find in file',
  query,
  onQueryChange,
  current,
  total,
  capped = false,
  onStep,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  label?: string
  query: string
  onQueryChange: (query: string) => void
  /** Zero-based index of the current match, or -1 for none. */
  current: number
  total: number
  /** The engine stopped counting; `total` is a floor. */
  capped?: boolean
  onStep: (delta: 1 | -1) => void
  onClose: () => void
}) {
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onStep(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover py-1 pr-1 pl-2.5 text-xs text-muted-foreground shadow-lg">
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder="Find"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-40 bg-transparent text-[13px] text-popover-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="min-w-16 px-1 text-right tabular-nums" aria-live="polite">
        {query
          ? total === 0
            ? 'No matches'
            : `${count.format(current + 1)} of ${count.format(total)}${capped ? '+' : ''}`
          : ''}
      </span>
      <FindButton label="Previous match" onClick={() => onStep(-1)} disabled={total === 0}>
        <ChevronUpIcon className="size-4" />
      </FindButton>
      <FindButton label="Next match" onClick={() => onStep(1)} disabled={total === 0}>
        <ChevronDownIcon className="size-4" />
      </FindButton>
      <FindButton label="Close find" onClick={onClose}>
        <XMarkIcon className="size-4" />
      </FindButton>
    </div>
  )
}

function FindButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  )
}

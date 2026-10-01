/**
 * The one find bar, for every engine that offers find (text, PDF, sheets):
 * a field, the match count, previous and next, close. Enter and Shift+Enter
 * step through matches; Escape closes the bar and is marked handled, so the
 * viewer stays open. The engine owns the matching, the highlighting and
 * focusing the field when find opens.
 */
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/outline'

export function FindBar({
  inputRef,
  query,
  onQueryChange,
  current,
  total,
  capped = false,
  searching = false,
  onStep,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  /** Zero-based index of the current match, or -1 for none. */
  current: number
  total: number
  /** The engine stopped counting; `total` is a floor. */
  capped?: boolean
  /** The engine is still looking (a PDF reads its pages' text first): no count yet. */
  searching?: boolean
  onStep: (delta: 1 | -1) => void
  onClose: () => void
}) {
  const intl = useIntl()

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
        aria-label={intl.formatMessage({
          id: 'files.find.ariaInFile',
          defaultMessage: 'Find in file',
        })}
        placeholder={intl.formatMessage({ id: 'files.find.label', defaultMessage: 'Find' })}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-40 bg-transparent text-[13px] text-popover-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="min-w-16 px-1 text-right tabular-nums" aria-live="polite">
        {query && !searching
          ? total === 0
            ? intl.formatMessage({ id: 'files.find.noMatches', defaultMessage: 'No matches' })
            : intl.formatMessage(
                {
                  id: capped ? 'files.find.matchCountCapped' : 'files.find.matchCount',
                  defaultMessage: capped ? '{current} of {total}+' : '{current} of {total}',
                },
                { current: current + 1, total }
              )
          : ''}
      </span>
      <FindButton
        label={intl.formatMessage({
          id: 'files.find.previousMatch',
          defaultMessage: 'Previous match',
        })}
        onClick={() => onStep(-1)}
        disabled={total === 0}
      >
        <ChevronUpIcon className="size-4" />
      </FindButton>
      <FindButton
        label={intl.formatMessage({ id: 'files.find.nextMatch', defaultMessage: 'Next match' })}
        onClick={() => onStep(1)}
        disabled={total === 0}
      >
        <ChevronDownIcon className="size-4" />
      </FindButton>
      <FindButton
        label={intl.formatMessage({ id: 'files.find.close', defaultMessage: 'Close find' })}
        onClick={onClose}
      >
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

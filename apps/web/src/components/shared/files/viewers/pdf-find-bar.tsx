/**
 * Find in a PDF: a small bar over the top right of the desk. Enter moves to
 * the next match, Shift+Enter to the previous one, Escape closes the bar
 * (and only the bar).
 */
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'

export function PdfFindBar({
  query,
  onQuery,
  count,
  active,
  searching,
  onStep,
  onClose,
  focusNonce,
}: {
  query: string
  onQuery: (query: string) => void
  count: number
  /** 0-based index of the current match, or -1. */
  active: number
  searching: boolean
  onStep: (direction: 1 | -1) => void
  onClose: () => void
  /** Changes each time find is asked for, to focus the field again. */
  focusNonce: number
}) {
  const intl = useIntl()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusNonce])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onStep(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // Closes the find bar, not the viewer.
      event.stopPropagation()
      onClose()
    }
  }

  const status =
    query.trim() === '' || searching
      ? ''
      : count === 0
        ? intl.formatMessage({ id: 'files.find.noMatches', defaultMessage: 'No matches' })
        : intl.formatMessage(
            { id: 'files.find.matchCount', defaultMessage: '{current} of {total}' },
            { current: active + 1, total: count }
          )

  return (
    <div
      role="search"
      className="absolute right-4 top-3 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label={intl.formatMessage({
          id: 'files.find.ariaInDocument',
          defaultMessage: 'Find in document',
        })}
        placeholder={intl.formatMessage({ id: 'files.find.label', defaultMessage: 'Find' })}
        className="h-7 w-44 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      <span aria-live="polite" className="min-w-14 px-1 text-xs tabular-nums text-muted-foreground">
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label={intl.formatMessage({
          id: 'files.find.previousMatch',
          defaultMessage: 'Previous match',
        })}
        disabled={count === 0}
        onClick={() => onStep(-1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label={intl.formatMessage({
          id: 'files.find.nextMatch',
          defaultMessage: 'Next match',
        })}
        disabled={count === 0}
        onClick={() => onStep(1)}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label={intl.formatMessage({ id: 'files.find.close', defaultMessage: 'Close find' })}
        onClick={onClose}
      >
        <XMarkIcon />
      </Button>
    </div>
  )
}

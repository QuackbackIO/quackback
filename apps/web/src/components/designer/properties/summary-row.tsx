/**
 * A look owned by an element, shown in a part's panel as one row: what it is
 * now, in a word or two, and a way to the element that sets it. Part panels
 * own behaviour and words; looks have one writer, the element's panel.
 */
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { PropertyRow } from './properties-panel'

export function SummaryRow({
  label,
  value,
  onOpen,
}: {
  label: string
  /** The look now, in a word or two. */
  value: string
  /** Picks the element that sets it. */
  onOpen: () => void
}) {
  return (
    <PropertyRow label={label}>
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        data-summary-row=""
        onClick={onOpen}
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
    </PropertyRow>
  )
}

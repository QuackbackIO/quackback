/**
 * A look owned by an element, shown in a part's panel as one row: what it is
 * now, in a word or two, and a way to the element that sets it. Part panels
 * own behaviour and words; looks have one writer, the element's panel.
 */
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'
import { PropertyRow } from './properties-panel'

export function SummaryRow({
  label,
  value,
  onOpen,
  find,
  expanded,
  controls,
  name,
}: {
  label: string
  /** Its stable name, which quick find goes to. */
  find?: string
  /** The look now, in a word or two. */
  value: string
  /** Picks the element that sets it, or opens what it summarises. */
  onOpen: () => void
  /** Whether what it summarises is open under it; the chevron turns down. Absent, it leads away. */
  expanded?: boolean
  /** The id of what it opens under it. */
  controls?: string
  /** Its accessible name, where "label: value" says too little. */
  name?: string
}) {
  return (
    <PropertyRow label={label} find={find}>
      <button
        type="button"
        aria-label={name ?? `${label}: ${value}`}
        aria-expanded={expanded}
        aria-controls={controls}
        data-summary-row=""
        onClick={onOpen}
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <ChevronRightIcon
          className={cn('size-3.5 text-muted-foreground', expanded && 'rotate-90')}
          aria-hidden="true"
        />
      </button>
    </PropertyRow>
  )
}

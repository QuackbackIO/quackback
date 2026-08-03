'use client'

import { useInboxes } from '@/lib/client/hooks/use-inboxes-queries'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface WebhookInboxPickerProps {
  /** Currently selected inbox IDs (string ids; backend stores text[]). */
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /**
   * When false, the picker still renders but is muted with a hint that the
   * filter is ignored unless at least one ticket.* event is selected.
   */
  active: boolean
}

/**
 * Optional inbox multi-select rendered under the event picker in the create
 * and edit webhook dialogs. Empty selection means "all inboxes" (matches the
 * backend semantics: `inboxIds === null || []` → match all).
 *
 * Phase 4 — per-inbox webhook filtering.
 */
export function WebhookInboxPicker({ value, onChange, disabled, active }: WebhookInboxPickerProps) {
  const inboxesQuery = useInboxes({ includeArchived: false })
  const inboxes = inboxesQuery.data ?? []

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }
  const clear = () => onChange([])

  return (
    <div className="space-y-2" aria-disabled={!active}>
      <div className="flex items-center justify-between">
        <Label className={active ? '' : 'text-muted-foreground'}>Inboxes (optional)</Label>
        {value.length > 0 && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {active
          ? value.length === 0
            ? 'Empty = match tickets in any inbox.'
            : `Only deliver ticket events from the selected inbox${value.length === 1 ? '' : 'es'}.`
          : 'Filter is ignored unless at least one ticket.* event is selected above.'}
      </p>
      {inboxesQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading inboxes…</p>
      ) : inboxes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No inboxes configured.</p>
      ) : (
        <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
          {inboxes.map((inbox) => (
            <label
              key={inbox.id}
              className="flex items-center gap-3 p-2 hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <Checkbox
                checked={value.includes(inbox.id)}
                onCheckedChange={() => toggle(inbox.id)}
                disabled={disabled || !active}
                aria-label={`Filter by inbox ${inbox.name}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{inbox.name}</p>
                <p className="text-xs text-muted-foreground truncate">{inbox.slug}</p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The ticket title in the thread header, renamable in place: click the title
 * (or its pencil) to edit, Enter or blur saves, Escape cancels. An unchanged
 * or empty title saves nothing. The server re-checks the permission, so a
 * teammate without it sees the rename refused rather than a hidden control.
 */
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { PencilSquareIcon } from '@heroicons/react/16/solid'
import { toast } from 'sonner'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { useSetTicketTitle } from '@/lib/client/mutations/inbox'

/** Matches createTicketSchema's and setTicketTitle's title bound. */
const MAX_TITLE_LENGTH = 300

export function TicketTitleEditor({
  ticket,
  onChanged,
}: {
  ticket: TicketDTO
  onChanged?: () => void
}) {
  const intl = useIntl()
  const mutation = useSetTicketTitle()
  const [draft, setDraft] = useState<string | null>(null)
  const renameLabel = intl.formatMessage({
    id: 'admin.ticketTitle.rename',
    defaultMessage: 'Rename ticket',
  })

  const save = () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (!next || next === ticket.title) return
    mutation.mutate(
      { ticketId: ticket.id, title: next },
      {
        onSuccess: () => onChanged?.(),
        onError: () =>
          toast.error(
            intl.formatMessage({
              id: 'admin.ticketTitle.renameFailed',
              defaultMessage: 'Could not rename the ticket',
            })
          ),
      }
    )
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        aria-label={renameLabel}
        value={draft}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(null)
          }
        }}
        className="w-full min-w-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  const shown = mutation.isPending && mutation.variables ? mutation.variables.title : ticket.title
  return (
    <button
      type="button"
      title={renameLabel}
      aria-label={renameLabel}
      onClick={() => setDraft(ticket.title)}
      className="group flex max-w-full min-w-0 items-center gap-1 rounded-md text-left"
    >
      <span className="truncate text-sm font-semibold">{shown}</span>
      <PencilSquareIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  )
}

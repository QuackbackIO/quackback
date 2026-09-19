/**
 * The middle column for the "Needs approval" view: the Quinn proposals this
 * teammate may decide, and the approved actions whose outcome nobody has
 * confirmed.
 *
 * Two sections rather than one list, because they ask for different things. A
 * proposal wants a decision, and the decision is made in the thread, where the
 * request's context is: clicking a row opens the parent conversation or ticket
 * with its card. An unconfirmed execution wants somebody to go and look, and
 * then record what they found; it is already decided, and nothing about it is
 * repeatable.
 *
 * Every row here is permission-scoped server side, by the item it belongs to
 * (see `listAssistantReviewQueueFn`). Hiding a row this viewer may not act on
 * is not the gate; the gate is that the decide and reconcile fns re-check the
 * same thing.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldExclamationIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/solid'
import type { AssistantPendingActionId } from '@quackback/ids'
import { assistantPendingActionQueries } from '@/lib/client/queries/assistant-pending-actions'
import type { AssistantReviewRowDTO } from '@/lib/server/functions/assistant-pending-actions'
import { ActionReconcileForm } from '@/components/conversation/action-reconcile-form'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/shared/spinner'
import { cn } from '@/lib/shared/utils'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function parentId(row: AssistantReviewRowDTO): string | null {
  return row.conversationId ?? row.ticketId
}

export function NeedsApprovalColumn({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  /** Open the proposal's parent item in the thread pane. */
  onSelect: (itemId: string) => void
}) {
  const { data, isLoading } = useQuery(assistantPendingActionQueries.reviewQueue())
  const [reconciling, setReconciling] = useState<string | null>(null)
  const proposed = data?.proposed ?? []
  const unconfirmed = data?.unconfirmed ?? []

  return (
    <div
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:w-80',
        selectedId && 'hidden md:flex'
      )}
    >
      <div className="border-b border-border/50 px-4 py-[1.1rem]">
        <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight">
          <ShieldExclamationIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          Needs approval
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : proposed.length === 0 && unconfirmed.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing waiting on a decision.
          </div>
        ) : (
          <>
            {proposed.map((row) => {
              const item = parentId(row)
              return (
                <button
                  key={row.id}
                  type="button"
                  disabled={!item}
                  onClick={() => item && onSelect(item)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                    item === selectedId && 'bg-muted'
                  )}
                >
                  <span className="truncate text-sm font-medium">{row.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.toolName} · asked {relativeTime(row.proposedAt)} ago
                  </span>
                </button>
              )
            })}
            {unconfirmed.length > 0 && (
              <div className="border-b border-border/40 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                Unconfirmed
              </div>
            )}
            {unconfirmed.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-1.5 border-b border-border/40 px-4 py-3"
              >
                <button
                  type="button"
                  disabled={!parentId(row)}
                  onClick={() => {
                    const item = parentId(row)
                    if (item) onSelect(item)
                  }}
                  className="flex flex-col gap-0.5 text-left"
                >
                  <span className="inline-flex items-center gap-1 truncate text-sm font-medium">
                    <QuestionMarkCircleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {row.summary}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Sent {row.dispatchedAt ? `${relativeTime(row.dispatchedAt)} ago` : ''}, never
                    confirmed
                  </span>
                </button>
                {reconciling === row.id ? (
                  <ActionReconcileForm
                    pendingActionId={row.id as AssistantPendingActionId}
                    receiptId={row.receiptId ?? undefined}
                    onDone={() => setReconciling(null)}
                    onCancel={() => setReconciling(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setReconciling(row.id)}
                    className="self-start rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Record what happened
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  )
}

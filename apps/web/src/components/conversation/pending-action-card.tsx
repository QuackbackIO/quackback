/**
 * The Approve/Reject card for a Quinn write-tool proposal, rendered on the
 * internal note that announced it (mirrors the postSuggestion chip in
 * message-bubble.tsx — same mount point, same visual language). The note's
 * metadata is only a point-in-time pointer (pendingActionId + toolName +
 * summary); this card fetches the LIVE pending-action row (via
 * usePendingActionDecision) so the buttons reflect current status rather
 * than the stale snapshot.
 */
import { CheckIcon, XMarkIcon, ShieldExclamationIcon } from '@heroicons/react/24/solid'
import type { AssistantPendingActionId } from '@quackback/ids'
import { usePendingActionDecision } from '@/lib/client/hooks/use-pending-action-decision'

/** Terminal-status copy — shown in place of the buttons once a proposal is no
 *  longer decidable. 'proposed' isn't here: that state renders the buttons. */
const TERMINAL_LABEL: Record<string, string> = {
  approved: 'Approved',
  executed: 'Approved and executed',
  rejected: 'Rejected',
  expired: 'Expired',
  failed: 'Failed',
}

export interface PendingActionCardProps {
  pendingActionId: string
  summary: string
}

function formatArgValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function PendingActionCard({ pendingActionId, summary }: PendingActionCardProps) {
  const id = pendingActionId as AssistantPendingActionId
  const { data, isLoading, isError, busy, inlineError, approve, reject } =
    usePendingActionDecision(id)
  const args =
    data?.args && typeof data.args === 'object' && !Array.isArray(data.args)
      ? (data.args as Record<string, unknown>)
      : null

  return (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
        <ShieldExclamationIcon className="h-3.5 w-3.5 shrink-0" /> {summary}
      </span>
      {args && Object.keys(args).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-amber-900/80 dark:text-amber-100/80">
          {Object.entries(args).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-medium">{key}</dt>
              <dd className="min-w-0 truncate">{formatArgValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {isLoading ? (
        <span className="text-[11px] text-muted-foreground">Checking status…</span>
      ) : isError ? (
        <span className="text-[11px] text-muted-foreground">Couldn't load the current status</span>
      ) : data?.status === 'proposed' ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={approve}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <CheckIcon className="h-3.5 w-3.5" /> Approve
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <XMarkIcon className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
      ) : (
        <span className="text-[11px] font-medium text-muted-foreground">
          {data ? (TERMINAL_LABEL[data.status] ?? data.status) : 'Unable to load status'}
        </span>
      )}
      {inlineError && <span className="text-[11px] text-destructive">{inlineError}</span>}
    </div>
  )
}

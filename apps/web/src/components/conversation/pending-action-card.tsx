/**
 * The Approve/Reject card for a Quinn write-tool proposal, rendered on the
 * internal note that announced it (mirrors the postSuggestion chip in
 * message-bubble.tsx — same mount point, same visual language). The note's
 * metadata is only a point-in-time pointer (pendingActionId + toolName +
 * summary); this card fetches the LIVE pending-action row (via
 * usePendingActionDecision) so the buttons reflect current status rather
 * than the stale snapshot.
 *
 * ## Three things, never one
 *
 * A review DECISION, an EXECUTION and a customer OUTCOME are independent, and
 * the card used to have a single label that ran them together: approving
 * printed "Approved and executed" because approving was executing. It is not
 * any more. Approval commits a decision and a job; a worker carries the effect
 * out afterwards and can still be refused by a live permission check, fail, or
 * come back unconfirmed. So the card renders the decision and the execution as
 * two separate readings, and asserts nothing at all about the customer
 * outcome: that is the thread, and no control here is entitled to claim it.
 *
 * An unconfirmed execution gets the only affordance it may have: a person's
 * verdict, with a note. There is deliberately no repeat button, because a
 * repeat of an effect nobody could confirm is the failure this whole path
 * exists to prevent.
 */
import { useState } from 'react'
import { CheckIcon, XMarkIcon, ShieldExclamationIcon } from '@heroicons/react/24/solid'
import type { AssistantPendingActionId } from '@quackback/ids'
import { usePendingActionDecision } from '@/lib/client/hooks/use-pending-action-decision'
import { ActionReconcileForm } from './action-reconcile-form'

/** The review decision, in the reviewer's words. `proposed` renders buttons instead. */
const DECISION_LABEL: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Declined',
  expired: 'Expired',
  executed: 'Approved',
  failed: 'Approved',
}

/** What the durable executor did. Absent means nothing has been dispatched. */
const EXECUTION_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Did not run',
  unknown: 'Not confirmed',
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
  const [reconciling, setReconciling] = useState(false)
  const args =
    data?.args && typeof data.args === 'object' && !Array.isArray(data.args)
      ? (data.args as Record<string, unknown>)
      : null
  // `superseded:` is recorded on the disposition because the status column's
  // CHECK cannot carry the word; the reviewer is told what happened, not what
  // the column had room for.
  const superseded = data?.disposition?.startsWith('superseded:') ?? false
  const decision = superseded ? 'Superseded' : (DECISION_LABEL[data?.status ?? ''] ?? data?.status)
  const execution = data?.executionState ? EXECUTION_LABEL[data.executionState] : null

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
        <dl className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <dt className="font-medium">Review</dt>
            <dd>{decision ?? 'Unable to load status'}</dd>
          </div>
          {execution && (
            <div className="flex items-center gap-1">
              <dt className="font-medium">Action</dt>
              <dd>{execution}</dd>
            </div>
          )}
        </dl>
      )}
      {data?.executionError && (
        <span className="text-[11px] text-muted-foreground">{data.executionError}</span>
      )}
      {data?.executionState === 'unknown' &&
        (reconciling ? (
          <ActionReconcileForm
            pendingActionId={id}
            onDone={() => setReconciling(false)}
            onCancel={() => setReconciling(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setReconciling(true)}
            className="self-start rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            Record what happened
          </button>
        ))}
      {inlineError && <span className="text-[11px] text-destructive">{inlineError}</span>}
    </div>
  )
}

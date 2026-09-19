/**
 * Run inspection beside the item it happened on (QUINN-PRODUCT Step 11, P8).
 *
 * The question this answers is "why did Quinn do that", and the shape follows
 * from where it is asked: in the inbox, next to the conversation, by whoever is
 * already reading it. So the list is quiet (one line per run, the newest first)
 * and the detail opens in a sheet rather than a page.
 *
 * Every reading here is one the records already make. The state, the
 * disposition and the timings are the run row; the validator verdict is a step;
 * the evidence is what was supplied; the receipts and the approval are kept as
 * the two separate readings Step 5 established, so approved-and-queued is never
 * drawn as completed. Nothing is inferred and nothing is averaged.
 *
 * The two controls state their own precondition: Stop appears only while a run
 * is unfinished, Run again only on a failed turn, and the server re-checks both
 * at the moment of the click because either can change while the sheet is open.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  cancelAssistantRunFn,
  getAssistantRunFn,
  listAssistantRunsFn,
  retryAssistantRunFn,
} from '@/lib/server/functions/assistant-runs'

const runsKey = ['admin', 'inbox', 'assistant-runs'] as const

/** What a run's state is called where a person reads it. */
const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Working',
  waiting_action: 'Waiting on approval',
  succeeded: 'Answered',
  suppressed: 'Said nothing',
  superseded: 'Replaced',
  cancelled: 'Stopped',
  failed: 'Failed',
}

/** The outcome a run produced, when it produced one. */
const OUTCOME_LABEL: Record<string, string> = {
  answer: 'Answer',
  clarification: 'Clarification',
  greeting: 'Greeting',
  inability: 'Could not answer',
  handoff: 'Handed over',
  resolution: 'Resolution',
}

/**
 * Why a run ended, in words.
 *
 * Only the dispositions a person can act on are translated. Everything else is
 * shown verbatim: an unrecognised disposition is information, and hiding it
 * behind a friendly blank is how an operator ends up unable to explain a run.
 */
export function dispositionNote(disposition: string | null): string | null {
  if (!disposition) return null
  if (disposition === 'stranded:no_worker') return 'The worker stopped before it finished'
  if (disposition === 'cancelled:operator') return 'Stopped by a teammate'
  if (disposition === 'engine:suppressed') return 'Nothing to say'
  if (disposition.startsWith('validation:'))
    return `Refused by validation: ${disposition.slice(11)}`
  if (disposition.startsWith('fence:')) return `Superseded: ${disposition.slice(6)}`
  if (disposition.startsWith('action:')) return `Action result: ${disposition.slice(7)}`
  return disposition
}

/** Statuses that mean a run is still moving and the surface must keep looking. */
const OPEN_STATUSES = ['queued', 'running', 'waiting_action']

/**
 * The teammate side of the durable status, and its polling fallback.
 *
 * The admin inbox deliberately ignores Quinn's realtime activity frames, which
 * are the customer's. A teammate's view of a turn in flight is therefore the
 * run row itself, and it has to keep looking while one is open: an SSE frame
 * that never arrives, or a worker that dies mid-turn, must still resolve to the
 * real state within a few seconds rather than leaving the panel saying Working
 * for ever. A settled list stops polling, because it can no longer change.
 */
export function runListPollInterval(
  runs: ReadonlyArray<{ status: string }> | undefined
): number | false {
  if (!runs) return false
  return runs.some((run) => OPEN_STATUSES.includes(run.status)) ? 5_000 : false
}

/**
 * What the turn spent, in and out.
 *
 * Null when nothing was recorded, and `Row` drops a null, so a run from before
 * the accounting stays quiet rather than claiming it was free.
 */
function tokens(prompt: number | null, completion: number | null): string | null {
  if (prompt === null && completion === null) return null
  return `${(prompt ?? 0).toLocaleString()} in, ${(completion ?? 0).toLocaleString()} out`
}

function duration(ms: number | null): string | null {
  if (ms === null) return null
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function RunDetail({ runId, onClosed }: { runId: string; onClosed: () => void }) {
  const cache = useQueryClient()
  const detail = useQuery({
    queryKey: [...runsKey, 'detail', runId],
    queryFn: () => getAssistantRunFn({ data: { runId } }),
    staleTime: 0,
    // Only while something is still moving: a settled run never changes again.
    refetchInterval: (query) =>
      query.state.data && OPEN_STATUSES.includes(query.state.data.status) ? 3_000 : false,
  })

  const invalidate = () => {
    void cache.invalidateQueries({ queryKey: runsKey })
  }

  const stop = useMutation({
    mutationFn: () => cancelAssistantRunFn({ data: { runId } }),
    onSuccess: () => {
      toast.success('Run stopped')
      invalidate()
    },
    onError: (error: Error) => toast.error(error.message || 'This run could not be stopped.'),
  })

  const again = useMutation({
    mutationFn: () => retryAssistantRunFn({ data: { runId } }),
    onSuccess: () => {
      toast.success('Running again')
      invalidate()
      onClosed()
    },
    onError: (error: Error) => toast.error(error.message || 'This turn could not be run again.'),
  })

  if (detail.isPending) return <p className="text-muted-foreground text-sm">Loading…</p>
  if (detail.isError || !detail.data) {
    return <p className="text-muted-foreground text-sm">This run is no longer available.</p>
  }
  const run = detail.data

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Row label="State" value={STATUS_LABEL[run.status] ?? run.status} />
        <Row
          label="Outcome"
          value={run.outcome ? (OUTCOME_LABEL[run.outcome] ?? run.outcome) : null}
        />
        <Row label="Why it ended" value={dispositionNote(run.disposition)} />
        <Row label="Error" value={run.errorReason} />
        <Row label="Trigger" value={run.triggerKind.replace(/_/g, ' ')} />
        <Row label="Waited to start" value={duration(run.queuedMs)} />
        <Row label="Total" value={duration(run.totalMs)} />
        <Row label="Tokens" value={tokens(run.promptTokens, run.completionTokens)} />
        <Row
          label="Delegated by"
          value={run.delegation ? `Workflow step ${run.delegation.nodeId}` : null}
        />
      </div>

      {run.behaviour && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">Behaviour</h4>
          <Row
            label="Release"
            value={run.behaviour.releaseNumber ? `#${run.behaviour.releaseNumber}` : 'Unreleased'}
          />
          <Row label="Snapshot" value={run.behaviour.contentHash.slice(0, 12)} />
          <Row label="Answer checks" value={run.behaviour.validatorMode} />
          <Row
            label="Guidance"
            value={
              run.guidanceOmittedIds.length > 0
                ? `${run.guidanceAppliedIds.length} applied, ${run.guidanceOmittedIds.length} left out for room`
                : `${run.guidanceAppliedIds.length} applied`
            }
          />
        </section>
      )}

      {run.validation.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">Validation</h4>
          {run.validation.map((verdict) => (
            <div key={verdict.step} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{verdict.step.replace(/_/g, ' ')}</span>
              <Badge variant={verdict.status === 'failed' ? 'destructive' : 'secondary'}>
                {verdict.status}
              </Badge>
            </div>
          ))}
        </section>
      )}

      {run.evidence.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">Evidence</h4>
          <ul className="space-y-1 text-sm">
            {run.evidence.map((item, index) => (
              <li key={`${item.sourceType}-${item.sourceId}-${index}`}>
                <span className="text-muted-foreground">{item.sourceType}</span>{' '}
                {item.citationIndex === null ? 'supplied' : 'cited'}
                {item.passage && (
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                    {item.passage}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(run.receipts.length > 0 || run.approvals.length > 0) && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">Actions</h4>
          {run.approvals.map((approval) => (
            <div key={approval.id} className="text-sm">
              <span>{approval.summary}</span>
              <p className="text-muted-foreground text-xs">
                Review: {approval.status}
                {approval.executionState ? ` · Execution: ${approval.executionState}` : ''}
                {approval.executionError ? ` · ${approval.executionError}` : ''}
              </p>
            </div>
          ))}
          {run.receipts.map((receipt) => (
            <div key={receipt.id} className="text-sm">
              <span>{receipt.toolName}</span>
              <p className="text-muted-foreground text-xs">
                {receipt.outcomeStatus ?? receipt.status}
                {receipt.reconciliationState === 'required' ? ' · needs a verdict' : ''}
              </p>
            </div>
          ))}
        </section>
      )}

      {(run.cancellable || run.retryable) && (
        <div className="flex gap-2 border-t pt-4">
          {run.cancellable && (
            <Button
              size="sm"
              variant="outline"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              Stop
            </Button>
          )}
          {run.retryable && (
            <Button
              size="sm"
              variant="outline"
              disabled={again.isPending}
              onClick={() => again.mutate()}
            >
              Run again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export interface QuinnRunInspectorProps {
  conversationId?: string
  ticketId?: string
}

export function QuinnRunInspector({ conversationId, ticketId }: QuinnRunInspectorProps) {
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const runs = useQuery({
    queryKey: [...runsKey, conversationId ?? ticketId],
    queryFn: () =>
      listAssistantRunsFn({
        data: conversationId ? { conversationId } : { ticketId: ticketId! },
      }),
    enabled: !!(conversationId ?? ticketId),
    staleTime: 15_000,
    refetchInterval: (query) => runListPollInterval(query.state.data),
  })

  if (runs.isPending || runs.isError) return null
  if (runs.data.length === 0) return null

  return (
    <div className="space-y-1">
      {runs.data.map((run) => (
        <button
          key={run.id}
          type="button"
          className="hover:bg-muted flex w-full items-baseline justify-between gap-2 rounded px-1 py-1 text-left text-xs"
          onClick={() => setOpenRunId(run.id)}
        >
          <span>{STATUS_LABEL[run.status] ?? run.status}</span>
          <span className="text-muted-foreground">
            <TimeAgo date={run.createdAt} />
          </span>
        </button>
      ))}
      <Sheet open={openRunId !== null} onOpenChange={(open) => !open && setOpenRunId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Quinn run</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            {openRunId && <RunDetail runId={openRunId} onClosed={() => setOpenRunId(null)} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

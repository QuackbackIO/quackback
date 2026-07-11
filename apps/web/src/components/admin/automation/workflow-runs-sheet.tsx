/**
 * Per-run drill-down for a workflow (support platform §4.6/§7 follow-up).
 * workflow_run_events is written on every state transition (workflow.engine.ts's
 * logRunEvent) but had no UI: a failing workflow was invisible beyond the
 * manager list's aggregate trailing-7d started/completed counts
 * (workflows-manager.tsx). Opened from a row's metrics cell, this Sheet lists
 * the workflow's recent runs (state, relative start/end time, a link to the
 * conversation) and, for the selected run, its ordered event timeline.
 *
 * Read-only, gated the same as the rest of the manager (routing.manage, via
 * workflowRunsFn/workflowRunTimelineFn — see functions/workflow-reporting.ts).
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowTopRightOnSquareIcon, ClockIcon } from '@heroicons/react/24/outline'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { EmptyState } from '@/components/shared/empty-state'
import { MENU_LABEL } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import {
  workflowRunsQuery,
  workflowRunTimelineQuery,
} from '@/lib/client/queries/workflow-reporting'
import type { WorkflowRunRow, WorkflowRunEventRow } from '@/lib/server/functions/workflow-reporting'
import { ACTION_LABELS } from './workflow-graph'

const RUN_STATE_META: Record<string, { label: string; dotClass: string; textClass: string }> = {
  running: {
    label: 'Running',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-600 dark:text-blue-400',
  },
  waiting: {
    label: 'Waiting',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  done: {
    label: 'Done',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  interrupted: {
    label: 'Interrupted',
    dotClass: 'bg-rose-500',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
}

const EVENT_KIND_LABELS: Record<string, string> = {
  started: 'Started',
  waiting: 'Waiting',
  completed: 'Completed',
  interrupted: 'Interrupted',
  swept_stale: 'Swept (stale)',
  swept_rescheduled: 'Swept (rescheduled)',
  swept_expired: 'Expired (customer never answered)',
  // Funnel (action.executor.ts's send_block case / event-trigger.ts's
  // tryResumeInputWait/tryResumeAssistantWait) — see workflow-reporting.ts's
  // sentRuns/engagedRuns rollup for the aggregate this timeline backs.
  block_sent: 'Block sent',
  block_engaged: 'Customer engaged',
  // call_connector park-and-continue loop (workflow.engine.ts's
  // applyPlanAndSettle): logged once per connector hop, plus once if the
  // MAX_CONNECTOR_HOPS safety bound is hit.
  'connector_result:success': 'Connector call succeeded',
  connector_hop_limit: 'Stopped (connector hop limit)',
}

/** Human-readable text for a `connector_failed:<reason>` event's reason —
 *  the same reasons action.executor.ts's CallConnectorResult/
 *  ConnectorExecutionResult can carry. Falls back to the raw reason string
 *  for one this map doesn't know (a future addition to the reason union). */
const CONNECTOR_FAILURE_REASON_LABELS: Record<string, string> = {
  rate_limited: 'rate limited',
  host_not_allowed: 'blocked host',
  http_error: 'HTTP error',
  network_error: 'network error',
  unavailable: 'connector unavailable',
  invalid_params: 'invalid inputs',
}

/**
 * Humanize a stored run-event kind (workflow.engine.ts's logRunEvent /
 * workflow-sweep.ts): the static labels above, or `action_failed:<type>` ->
 * "Action failed: <the action's display label>", or `connector_failed:
 * <reason>` -> "Connector call failed (<human reason>)" — falling back to
 * the raw type/reason string for an unknown/removed one (the same
 * defensive-read stance the rest of the builder takes on a stored reference
 * it can't resolve, e.g. actionSummary's `named()` helper in
 * workflow-graph.ts). Anything else round-trips verbatim so a future event
 * kind never renders blank. Exported for the component test.
 */
export function humanizeRunEventKind(kind: string): string {
  const known = EVENT_KIND_LABELS[kind]
  if (known) return known
  if (kind.startsWith('action_failed:')) {
    const actionType = kind.slice('action_failed:'.length)
    const label = (ACTION_LABELS as Partial<Record<string, string>>)[actionType] ?? actionType
    return `Action failed: ${label}`
  }
  if (kind.startsWith('connector_failed:')) {
    const reason = kind.slice('connector_failed:'.length)
    const label = CONNECTOR_FAILURE_REASON_LABELS[reason] ?? reason
    return `Connector call failed (${label})`
  }
  return kind
}

function RunStateBadge({ state }: { state: string }) {
  const meta = RUN_STATE_META[state] ?? {
    label: state,
    dotClass: 'bg-muted-foreground',
    textClass: 'text-muted-foreground',
  }
  return (
    <Badge variant="outline" size="sm" shape="pill" className={cn('gap-1', meta.textClass)}>
      <span className={cn('size-1.5 rounded-full', meta.dotClass)} />
      {meta.label}
    </Badge>
  )
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: WorkflowRunRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-muted/60'
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <RunStateBadge state={run.state} />
          <span className="text-muted-foreground">
            <TimeAgo date={run.startedAt} />
          </span>
        </div>
        {run.conversationId && (
          <Link
            to="/admin/inbox"
            search={{ i: run.conversationId }}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open conversation
            <ArrowTopRightOnSquareIcon className="size-3" />
          </Link>
        )}
      </div>
    </button>
  )
}

function TimelineRow({ event }: { event: WorkflowRunEventRow }) {
  const failed =
    event.kind.startsWith('action_failed:') || event.kind.startsWith('connector_failed:')
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span className={cn('font-medium', failed && 'text-destructive')}>
        {humanizeRunEventKind(event.kind)}
      </span>
      <TimeAgo date={event.at} className="shrink-0 text-xs text-muted-foreground" />
    </div>
  )
}

export function WorkflowRunsSheet({
  workflowId,
  workflowName,
  open,
  onOpenChange,
}: {
  /** Null while closed — queries stay disabled (see workflowRunsQuery/
   *  workflowRunTimelineQuery's `enabled` gates) so closing never pays for a
   *  fetch. */
  workflowId: string | null
  workflowName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const { data: runs, isLoading } = useQuery(workflowRunsQuery(open ? workflowId : null))
  const { data: timeline, isLoading: timelineLoading } = useQuery(
    workflowRunTimelineQuery(open ? selectedRunId : null)
  )

  // Default to the most recent run whenever the list (re)loads for a
  // different/newly-opened workflow; a stale selection from a previously
  // opened workflow must never leak into this one's timeline query.
  useEffect(() => {
    if (!open) {
      setSelectedRunId(null)
      return
    }
    if (runs && runs.length > 0 && !runs.some((r) => r.id === selectedRunId)) {
      setSelectedRunId(runs[0]!.id)
    }
    if (runs && runs.length === 0) setSelectedRunId(null)
    // Only re-derive off `runs`/`open`; selectedRunId is intentionally read, not depended on, to avoid clobbering a manual selection.
  }, [runs, open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Run history</SheetTitle>
          <p className="truncate text-xs text-muted-foreground">{workflowName}</p>
        </SheetHeader>

        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : !runs || runs.length === 0 ? (
          <EmptyState
            icon={ClockIcon}
            title="No runs yet"
            description="This workflow hasn't started a run. Once it dispatches, its runs and their event timelines show up here."
          />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x">
            <div className="min-h-0 overflow-y-auto p-2">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={run.id === selectedRunId}
                  onSelect={() => setSelectedRunId(run.id)}
                />
              ))}
            </div>
            <div className="min-h-0 overflow-y-auto p-3">
              <div className={cn('mb-1 px-1', MENU_LABEL)}>Timeline</div>
              {timelineLoading ? (
                <div className="px-1 text-sm text-muted-foreground">Loading…</div>
              ) : !timeline || timeline.length === 0 ? (
                <div className="px-1 text-sm text-muted-foreground">No events recorded.</div>
              ) : (
                <div className="divide-y divide-border px-1">
                  {timeline.map((event, i) => (
                    // Same (runId, kind, at) triple can repeat (e.g. a plan with
                    // two failing actions of the same type in one run), so the
                    // index is part of the key.
                    <TimelineRow key={`${event.kind}-${event.at}-${i}`} event={event} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

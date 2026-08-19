/**
 * A workflow run's timeline writer (support platform §4.6). `logRunEvent`
 * appends one row to `workflow_run_events` — the append-only ledger
 * workflow-reporting.ts reads back for the sent -> engaged -> completed
 * funnel and the run detail view's timeline. Split out as its own leaf
 * module (no other workflows import) so both the engine (workflow.engine.ts)
 * and action.executor.ts can write to the ledger directly without either one
 * importing the other — action.executor.ts is imported BY workflow.engine.ts
 * (applyAction), so an import the other way would cycle.
 */
import {
  db,
  workflowRunEvents,
  type Workflow,
  type WorkflowRun,
  type Transaction,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

type Executor = typeof db | Transaction

/** Append to a run's timeline. Exported for the sweeper, which records its
 *  reconciliations (swept_stale, swept_rescheduled) the same way. `executor`
 *  defaults to `db`; runWorkflow passes its transaction so the 'started'
 *  event lands atomically with the run insert (see runWorkflow). */
export async function logRunEvent(
  runId: string,
  workflowId: string,
  subjectPrincipalId: PrincipalId | null,
  kind: string,
  executor: Executor = db
): Promise<void> {
  await executor.insert(workflowRunEvents).values({
    runId: runId as WorkflowRun['id'],
    workflowId: workflowId as Workflow['id'],
    subjectPrincipalId,
    kind,
  })
}

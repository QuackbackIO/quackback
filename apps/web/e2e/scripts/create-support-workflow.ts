/**
 * CLI: create a workflow through the app's own service (graph validated the
 * way the builder's save validates it), optionally publish it, and print
 * `{ id }` (TypeID). Also keeps one never-matching live "sentinel" workflow so
 * the app's 30 s "is any workflow live?" cache never holds a stale `false`
 * across a test's own workflow going live from this out-of-process script.
 *
 * Usage: bun create-support-workflow.ts '<json WorkflowInput & { live?: boolean }>'
 *        bun create-support-workflow.ts --status <workflowId> <draft|live|paused>
 *        bun create-support-workflow.ts --delete <workflowId>
 */
import { db, eq, and, isNull, workflows } from '@/lib/server/db'
import {
  createWorkflow,
  setWorkflowStatus,
  softDeleteWorkflow,
} from '@/lib/server/domains/workflows/workflow.service'
import { workflowGraphSchema } from '@/lib/server/domains/workflows/workflow.schemas'
import type { WorkflowId } from '@quackback/ids'

const SENTINEL_NAME = 'E2E sentinel (never matches)'

async function ensureSentinel(): Promise<boolean> {
  const live = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
    .limit(1)
  const [sentinel] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.name, SENTINEL_NAME), isNull(workflows.deletedAt)))
    .limit(1)
  if (!sentinel) {
    const row = await createWorkflow({
      name: SENTINEL_NAME,
      class: 'background',
      triggerType: 'page.visited',
      triggerSettings: { pagePath: '/__e2e-sentinel-never-visited' },
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })
    await setWorkflowStatus(row.id, 'live')
  }
  // True when nothing was live before: the app may hold a cached "no live
  // workflow" answer for up to 30 s.
  return live.length === 0
}

try {
  const args = process.argv.slice(2)
  if (args[0] === '--status') {
    await setWorkflowStatus(args[1] as WorkflowId, args[2] as 'draft' | 'live' | 'paused')
    process.stdout.write(JSON.stringify({ id: args[1] }))
  } else if (args[0] === '--delete') {
    await softDeleteWorkflow(args[1] as WorkflowId)
    process.stdout.write(JSON.stringify({ id: args[1] }))
  } else {
    const input = JSON.parse(args[0] ?? '{}')
    const { live, ...rest } = input
    if (rest.graph) workflowGraphSchema.parse(rest.graph)
    const coldCache = await ensureSentinel()
    const row = await createWorkflow(rest)
    if (live) await setWorkflowStatus(row.id, 'live')
    process.stdout.write(JSON.stringify({ id: row.id, coldCache }))
  }
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

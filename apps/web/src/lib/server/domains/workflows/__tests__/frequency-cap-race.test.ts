/**
 * Real-DB, non-rollback regression test for the frequency-cap race (§4.6
 * hardening): two concurrent dispatches for the SAME (workflow, person) must
 * produce exactly one run once the workflow has a frequency cap configured.
 *
 * This deliberately does NOT use the domain's usual db-test-fixture
 * (createDbTestFixture / testDb): that fixture parks every test inside one
 * transaction on a single connection, so two "concurrent" calls in the same
 * test can only ever run as savepoints on that one connection — sufficient
 * for pinning insert-time conflict behavior sequentially (see
 * workflow.engine.test.ts), but incapable of reproducing a genuine
 * two-connections, two-truly-interleaved-transactions race.
 *
 * Instead, `db` is mocked to a plain ad hoc connection pool (createDb,
 * bypassing the app's config.ts validation the same way
 * db-test-fixture.ts's own pool does) with real commits, not a transaction.
 * Every row this test creates is deleted explicitly in afterAll instead of
 * relying on a rollback.
 *
 * Only action.executor is mocked (applyAction), matching workflow.engine.
 * test.ts's convention, so the run/cap-accounting DB writes stay real while a
 * real close/set_priority side effect (which would itself emit further
 * events) doesn't muddy this test.
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type WorkflowId,
} from '@quackback/ids'

vi.mock('../action.executor', () => ({ applyAction: vi.fn().mockResolvedValue('ok') }))

// Dispatch resolves a condition context, which reads the workspace office-hours
// schedule from the settings blob — this ad hoc DB has no settings row, so pin
// the default (disabled = 24/7) like condition.context.test.ts does.
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({
    enabled: false,
    timezone: 'UTC',
    intervals: [],
  })),
}))

// A real, non-transactional pool — bypasses config.ts's full env validation
// (which the app's `db` singleton requires) the same way board-view-filter-
// parity.test.ts and db-test-fixture.ts's own pool do. `max: 5` covers the
// two genuinely concurrent transactions this test races against each other.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const { createDb } = await import('@quackback/db/client')
  const url = process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

import {
  db,
  sql,
  eq,
  inArray,
  workflows,
  workflowRuns,
  workflowRunEvents,
  conversations,
  user,
  principal,
} from '@/lib/server/db'
import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { dispatchWorkflowTrigger, type WorkflowTrigger } from '../dispatcher'

let dbAvailable = false
try {
  await db.execute(sql`select 1`)
  await db.execute(sql`select id from ${workflows} limit 0`)
  dbAvailable = true
} catch {
  dbAvailable = false
}

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await db.insert(user).values({ id: userId, name: `Race-${suffix()}` })
  await db
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return { userId, principalId }
}

async function seedConversation(): Promise<{
  conversationId: ConversationId
  userId: UserId
  principalId: PrincipalId
}> {
  const { userId, principalId } = await seedPrincipal()
  const [row] = await db
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority: 'none' })
    .returning()
  return { conversationId: row.id, userId, principalId }
}

describe.skipIf(!dbAvailable)(
  'frequency cap race (real DB, real commits, genuine concurrency)',
  () => {
    // Every id this test creates, cleaned up in afterAll — FK order matters:
    // workflows first (cascades workflow_runs/workflow_run_events), then
    // conversations (visitor_principal_id is ON DELETE RESTRICT), then
    // principals, then users.
    const createdWorkflowIds: WorkflowId[] = []
    const createdConversationIds: ConversationId[] = []
    const createdPrincipalIds: PrincipalId[] = []
    const createdUserIds: UserId[] = []

    afterAll(async () => {
      if (!dbAvailable) return
      if (createdWorkflowIds.length) {
        await db.delete(workflows).where(inArray(workflows.id, createdWorkflowIds))
      }
      if (createdConversationIds.length) {
        await db.delete(conversations).where(inArray(conversations.id, createdConversationIds))
      }
      if (createdPrincipalIds.length) {
        await db.delete(principal).where(inArray(principal.id, createdPrincipalIds))
      }
      if (createdUserIds.length) {
        await db.delete(user).where(inArray(user.id, createdUserIds))
      }
    })

    it('two concurrent dispatchWorkflowTrigger calls for a once-capped workflow, same person, two conversations -> exactly one run', async () => {
      const wf = await createWorkflow({
        name: `Once-capped race test ${suffix()}`,
        class: 'background',
        triggerType: 'conversation.created',
        triggerSettings: { frequencyCap: { type: 'once' } },
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [{ from: 't', to: 'a' }],
        },
      })
      createdWorkflowIds.push(wf.id)
      await setWorkflowStatus(wf.id, 'live')

      const convA = await seedConversation()
      const convB = await seedConversation()
      const person = await seedPrincipal()
      createdConversationIds.push(convA.conversationId, convB.conversationId)
      createdPrincipalIds.push(convA.principalId, convB.principalId, person.principalId)
      createdUserIds.push(convA.userId, convB.userId, person.userId)

      const triggerFor = (conversationId: ConversationId): WorkflowTrigger => ({
        triggerType: 'conversation.created',
        conversationId,
        actorType: 'user',
        subjectPrincipalId: person.principalId,
        message: null,
      })

      // Genuinely concurrent: two real transactions on two real connections
      // (the ad hoc pool above), each racing to take the (workflow, person)
      // advisory lock and re-check the cap. Before the fix, both would read
      // zero prior runs and both would insert.
      await Promise.all([
        dispatchWorkflowTrigger(triggerFor(convA.conversationId)),
        dispatchWorkflowTrigger(triggerFor(convB.conversationId)),
      ])

      const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, wf.id))
      expect(runs).toHaveLength(1)

      const events = await db
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.workflowId, wf.id))
      expect(events.filter((e) => e.kind === 'started')).toHaveLength(1)
    })
  }
)

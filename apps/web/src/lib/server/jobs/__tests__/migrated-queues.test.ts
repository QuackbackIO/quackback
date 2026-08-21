/**
 * The eight migrated queues, at the two seams a definition table cannot cover.
 *
 * **The enqueue site.** `import` and `export` state `maxAttempts: 1` at their
 * own enqueue call as well as on the definition, because that is the property
 * a reader of the import path needs to see and it is too costly to leave
 * implicit in one place. Two statements of one rule need two tests, or the
 * second is decoration a refactor can drop unnoticed.
 *
 * **The schedule gate.** `email-imap` refuses to schedule under pooled tenancy:
 * its mailbox is process-wide configuration while the queue is per tenant, so
 * scheduling it on every tenant's loop would have each tenant poll the same
 * mailbox and ingest the same message into its own database. Nothing else in
 * the suite would notice that refusal disappearing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cleanupQueues,
  closeHarness,
  ensureJobQueueSchema,
  rowsFor,
  testDb,
  uniqueQueue,
} from './harness'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Keep the real tables and operators — the migrated modules now import their
  // work statically, so their graph must still resolve — and swap only the
  // connection for the harness's committing one.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const handle = testDb()
        const value = Reflect.get(handle as object, prop, handle)
        return typeof value === 'function' ? value.bind(handle) : value
      },
    }
  ),
}))

vi.mock('@/lib/server/tenancy/tenant-context', () => ({
  getCurrentTenant: () => null,
}))

let pooled = false
vi.mock('@/lib/server/config', () => ({
  config: {
    get isPooledTenancy() {
      return pooled
    },
  },
}))

let imapEnv: Record<string, string | undefined> = {}
vi.mock('@/lib/server/domains/conversation/conversation.email-imap', () => ({
  readImapConfig: () => (imapEnv.configured ? { host: 'imap.example.test' } : null),
  createImapClient: async () => ({ close: async () => {} }),
  pollOnce: async () => ({ ingested: 0, failed: 0 }),
}))

import { IMPORT_QUEUE, enqueueImportCommitJob } from '@/lib/server/domains/import/import-queue'
import { EXPORT_QUEUE, enqueueWorkspaceExportJob } from '@/lib/server/domains/export/export-queue'
import { isEmailImapPollable } from '@/lib/server/domains/conversation/conversation.email-imap-queue'
import { enqueueJob } from '../job-queue'
import { findJobDefinition, maxAttemptsFor } from '../definitions'

beforeAll(async () => {
  await ensureJobQueueSchema()
})

const scratch: string[] = []
afterAll(async () => {
  await cleanupQueues(scratch)
  await closeHarness()
})

describe('at-most-once is stated at the enqueue site too', () => {
  it('import writes a row with one attempt', async () => {
    // A row on the real queue name would collide with another worktree's, so
    // the assertion is on the row this call wrote, found by its own payload.
    const runId = `imprun_${Date.now().toString(36)}`
    await enqueueImportCommitJob({ runId, source: 'csv', input: {} } as never)
    const rows = (await rowsFor(IMPORT_QUEUE)).filter(
      (r) => (r.payload as { runId?: string }).runId === runId
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].max_attempts).toBe(1)
  })

  it('export writes a row with one attempt', async () => {
    const runId = `exprun_${Date.now().toString(36)}`
    await enqueueWorkspaceExportJob({ runId, workspaceSlug: 'probe' } as never)
    const rows = (await rowsFor(EXPORT_QUEUE)).filter(
      (r) => (r.payload as { runId?: string }).runId === runId
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].max_attempts).toBe(1)
  })

  it('and on the definitions the tier reads', () => {
    expect(maxAttemptsFor(findJobDefinition(IMPORT_QUEUE)!)).toBe(1)
    expect(maxAttemptsFor(findJobDefinition(EXPORT_QUEUE)!)).toBe(1)
  })

  it('the control: an ordinary enqueue also defaults to one attempt, so the cases above are about the two declarations agreeing', async () => {
    const q = uniqueQueue('default-attempts')
    scratch.push(q)
    await enqueueJob({ queue: q })
    expect((await rowsFor(q))[0].max_attempts).toBe(1)
  })
})

describe('the email-imap schedule gate', () => {
  it('is closed when no mailbox is configured', () => {
    imapEnv = {}
    pooled = false
    expect(isEmailImapPollable()).toBe(false)
  })

  it('is open on a single-tenant install with a mailbox', () => {
    imapEnv = { configured: '1' }
    pooled = false
    expect(isEmailImapPollable()).toBe(true)
  })

  it('is REFUSED under pooled tenancy even with a mailbox configured', () => {
    // One shared mailbox polled from every tenant's loop would ingest the same
    // message into every tenant's database. It fails closed rather than
    // silently fanning a mailbox out across the fleet.
    imapEnv = { configured: '1' }
    pooled = true
    expect(isEmailImapPollable()).toBe(false)
  })
})

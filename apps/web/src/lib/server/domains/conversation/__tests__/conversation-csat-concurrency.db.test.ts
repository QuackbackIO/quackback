/**
 * Real-Postgres proof that the CSAT row lock serializes racing widget calls.
 *
 * The racing connections have to see the row, so it is committed, into
 * copies of the two tables recordCsat touches in a schema of this suite's
 * own: no other suite's transaction can read what it commits.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createId, type ConversationId, type PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const race = vi.hoisted(() => ({
  schema: `csat_race_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
}))

// Domain code imports the global `db`; point it at this suite's schema.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const target = race.db as Record<string | symbol, unknown>
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }
  ),
}))

const emit = vi.hoisted(() => ({
  submitted: vi.fn(),
  commentAdded: vi.fn(),
}))

vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: emit.submitted,
  emitConversationCsatCommentAdded: emit.commentAdded,
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string }) => ({ id: row.id })),
}))

vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  attributeCsatIfLastHandler: vi.fn(),
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connections rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, conversations, eq, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { recordCsat } from '../conversation.service'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  for (const table of ['conversations', 'conversation_messages']) {
    await admin.unsafe(`create table ${race.schema}.${table} (like public.${table} including all)`)
  }
  pool = postgres(url, { max: 4, connection: { search_path: `${race.schema}, public` } })
  race.db = createDbFromSql(pool)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(async () => {
  await pool?.end()
  await admin?.unsafe(`drop schema if exists ${race.schema} cascade`).catch(() => {})
  await admin?.end()
})

/**
 * Wait until `count` sessions queue behind the backend `pid`. A second waiter
 * on a row queues behind the first, so the chain is followed, not one hop.
 */
async function waitForBlockedBy(pid: number, count: number): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const [{ blocked }] = getExecuteRows<{ blocked: number }>(
      await db.execute(sql`
        with recursive waiting(pid) as (
          select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
          union
          select a.pid from pg_stat_activity a join waiting w on w.pid = any(pg_blocking_pids(a.pid))
        )
        select count(*)::int as blocked from waiting
      `)
    )
    if (blocked >= count) return
    if (Date.now() > deadline) throw new Error(`only ${blocked} of ${count} calls reached the row`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.skipIf(!available)('recordCsat concurrency', () => {
  it('keeps one score and emits each once when rating and comment calls race', async () => {
    const principalId = createId('principal') as PrincipalId
    const conversationId = createId('conversation') as ConversationId
    await db.insert(conversations).values({
      id: conversationId,
      visitorPrincipalId: principalId,
      channel: 'messenger',
    })

    const actor: Actor = {
      principalId,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    }

    // Two calls only race if both are inside their transaction before either
    // commits, which a plain Promise.all leaves to chance. So a third
    // connection holds the row until both calls are waiting on it: with the
    // row lock they then run one after the other, and without it both have
    // already read the unrated row.
    let releaseRow!: () => void
    const rowReleased = new Promise<void>((resolve) => (releaseRow = resolve))
    let rowHolderPid!: (pid: number) => void
    const holderPid = new Promise<number>((resolve) => (rowHolderPid = resolve))
    const holding = db.transaction(async (tx) => {
      await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for('update')
      const [{ pid }] = getExecuteRows<{ pid: number }>(
        await tx.execute(sql`select pg_backend_pid() as pid`)
      )
      rowHolderPid(pid)
      await rowReleased
    })
    const pid = await holderPid

    const racing = Promise.all([
      recordCsat(conversationId, 5, undefined, actor),
      recordCsat(conversationId, 1, 'context', actor),
    ])
    try {
      await waitForBlockedBy(pid, 2)
    } finally {
      releaseRow()
      await holding
    }
    await racing

    const stored = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    })
    expect(stored?.csatRating).toBe(emit.submitted.mock.calls[0]?.[1]?.csatRating)
    expect(stored?.csatSubmittedAt).toEqual(emit.submitted.mock.calls[0]?.[1]?.csatSubmittedAt)
    expect(stored?.csatComment).toBe('context')
    expect(emit.submitted).toHaveBeenCalledTimes(1)
    expect(emit.commentAdded).toHaveBeenCalledTimes(1)
  })
})

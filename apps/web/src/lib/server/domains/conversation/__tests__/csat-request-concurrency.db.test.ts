/**
 * Real-Postgres proof that two workflows asking for a rating at once post one
 * csat block: the post locks the conversation row and checks the ask signals
 * on the same transaction.
 *
 * The racing connections have to see the row, so it is committed, into
 * copies of the tables the ask touches in a schema of this suite's own: no
 * other suite's transaction can read what it commits.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createId, type ConversationId, type PrincipalId } from '@quackback/ids'

const race = vi.hoisted(() => ({
  schema: `csat_ask_race_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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
  toMessageDTO: vi.fn((row: { id: string }) => ({ id: row.id })),
}))

vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  attributeCsatIfLastHandler: vi.fn(),
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connections rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, conversations, conversationMessages, eq, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { appendAssistantReply } from '../conversation.service'
import { mayAskForCsat } from '../csat-request.service'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  for (const table of ['conversations', 'conversation_messages', 'email_log']) {
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

describe.skipIf(!available)('csat ask concurrency', () => {
  it('posts one csat block when two asks race', async () => {
    const assistantId = createId('principal') as PrincipalId
    const conversationId = createId('conversation') as ConversationId
    await db.insert(conversations).values({
      id: conversationId,
      visitorPrincipalId: createId('principal') as PrincipalId,
      channel: 'messenger',
    })

    const ask = () =>
      appendAssistantReply(
        conversationId,
        'How did we do?',
        { principalId: assistantId, displayName: 'Assistant' },
        {
          waiting: false,
          metadata: {
            block: {
              v: 1,
              kind: 'csat',
              runId: 'run_x',
              nodeId: 'node_x',
              waiting: true,
              allowTypingInterrupt: true,
              commentPrompt: 'Anything else?',
            },
          },
          onlyIf: mayAskForCsat(conversationId),
        }
      )

    // Two asks only race if both are inside their transaction before either
    // commits, which a plain Promise.all leaves to chance. So a third
    // connection holds the row until both asks are waiting on it: with the
    // row lock they then run one after the other, and without it both have
    // already found no earlier ask and written their block.
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

    const racing = Promise.all([ask(), ask()])
    try {
      await waitForBlockedBy(pid, 2)
    } finally {
      releaseRow()
      await holding
    }
    const results = await racing

    const blocks = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
    expect(blocks).toHaveLength(1)
    expect(results.filter((r) => r === null)).toHaveLength(1)
  })
})

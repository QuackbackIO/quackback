import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
// Independent connections are necessary to exercise PostgreSQL row contention.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { assistantInvolvements, conversations, principal, eq, sql } from '@/lib/server/db'
import { openInvolvement, getActiveInvolvement } from '../assistant.involvement'
import type { ConversationId, PrincipalId } from '@quackback/ids'

const firstClient = postgres(process.env.DATABASE_URL!, { max: 1 })
const secondClient = postgres(process.env.DATABASE_URL!, { max: 1 })
const first = createDbFromSql(firstClient)
const second = createDbFromSql(secondClient)
let conversationId: ConversationId
let principalId: PrincipalId
const available = await first.execute(sql`SELECT 1`).then(
  () => true,
  () => false
)

describe.skipIf(!available)(
  'active involvement concurrency (independent PostgreSQL connections)',
  () => {
    beforeAll(async () => {
      const [visitor] = await first
        .insert(principal)
        .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
        .returning()
      principalId = visitor.id
      const [conversation] = await first
        .insert(conversations)
        .values({ visitorPrincipalId: principalId, channel: 'messenger' })
        .returning()
      conversationId = conversation.id
    })
    afterAll(async () => {
      if (conversationId)
        await first.delete(conversations).where(eq(conversations.id, conversationId))
      if (principalId) await first.delete(principal).where(eq(principal.id, principalId))
    })

    it('concurrent opens share one identity and preserve the winning trigger', async () => {
      const opened = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          openInvolvement(
            { conversationId, triggeredBy: i % 2 ? 'workflow' : 'first_touch' },
            i % 2 ? first : second
          )
        )
      )
      expect(new Set(opened.map((row) => row.id)).size).toBe(1)
      expect(new Set(opened.map((row) => row.triggeredBy)).size).toBe(1)
      const rows = await first
        .select()
        .from(assistantInvolvements)
        .where(eq(assistantInvolvements.conversationId, conversationId))
      expect(rows).toHaveLength(1)
      await expect(
        first.insert(assistantInvolvements).values({ conversationId, triggeredBy: 'first_touch' })
      ).rejects.toThrow()
    })

    it('preserves finished history and enlists a new involvement in the caller transaction', async () => {
      const previous = await getActiveInvolvement(conversationId, first)
      expect(previous).not.toBeNull()
      await first
        .update(assistantInvolvements)
        .set({ status: 'handed_off', endedAt: new Date() })
        .where(eq(assistantInvolvements.id, previous!.id))
      await expect(
        first.transaction(async (tx) => {
          const created = await openInvolvement(
            { conversationId, triggeredBy: 'agent_handback' },
            tx
          )
          expect(created.id).not.toBe(previous!.id)
          throw new Error('rollback intake')
        })
      ).rejects.toThrow('rollback intake')
      expect(await getActiveInvolvement(conversationId, second)).toBeNull()
      const opened = await openInvolvement(
        { conversationId, triggeredBy: 'agent_handback' },
        second
      )
      expect(opened.id).not.toBe(previous!.id)
      const rows = await first
        .select()
        .from(assistantInvolvements)
        .where(eq(assistantInvolvements.conversationId, conversationId))
      expect(rows.map((row) => row.status).sort()).toEqual(['active', 'handed_off'])
    })

    it('migration preflight refuses legacy duplicates without reclassifying them', async () => {
      const migration = readFileSync(
        new URL(
          '../../../../../../../../packages/db/drizzle/0286_quinn_active_involvement.sql',
          import.meta.url
        ),
        'utf8'
      ).split('--> statement-breakpoint')[0]
      await expect(
        first.transaction(async (tx) => {
          // A transaction-local shadow table models pre-index legacy data without
          // dropping the real index or changing any workspace history.
          await tx.execute(
            sql`CREATE TEMP TABLE assistant_involvements (conversation_id uuid, status text) ON COMMIT DROP`
          )
          await tx.execute(
            sql`INSERT INTO assistant_involvements VALUES ('00000000-0000-0000-0000-000000000001', 'active'), ('00000000-0000-0000-0000-000000000001', 'active')`
          )
          await tx.execute(sql.raw(migration))
        })
      ).rejects.toMatchObject({
        cause: {
          code: 'P0001',
          message: expect.stringContaining('duplicates require reviewed repair'),
        },
      })
      expect(await getActiveInvolvement(conversationId, first)).not.toBeNull()
    })
  }
)

afterAll(async () => {
  await Promise.all([firstClient.end(), secondClient.end()])
})

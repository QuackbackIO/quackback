import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'
const migration = readFileSync(
  new URL('../../drizzle/0292_workspace_copilot.sql', import.meta.url),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)
it('replays without changing data or constraints and enforces private run dedupe', async () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test',
    { max: 1 }
  )
  const rollback = new Error('owned migration fixture rollback')
  try {
    await db.transaction(async (tx) => {
      for (const statement of migration) await tx.execute(sql.raw(statement))
      const [person] = await tx.execute(
        sql`INSERT INTO principal (id,role,type,display_name,created_at) VALUES (gen_random_uuid(),'member','user','Acme',now()) RETURNING id`
      )
      const [conversation] = await tx.execute(
        sql`INSERT INTO conversations (id,visitor_principal_id,channel) VALUES (gen_random_uuid(),${person.id},'messenger') RETURNING id`
      )
      const [status] = await tx.execute(
        sql`INSERT INTO ticket_statuses (id,name,slug) VALUES (gen_random_uuid(),'Acme',${`acme-${person.id}`}) RETURNING id`
      )
      const [ticket] = await tx.execute(
        sql`INSERT INTO tickets (id,title,status_id) VALUES (gen_random_uuid(),'Acme',${status.id}) RETURNING id`
      )
      await tx.execute(
        sql`INSERT INTO conversation_messages (id,conversation_id,sender_type,content,is_internal) VALUES (gen_random_uuid(),${conversation.id},'visitor','Existing conversation',false)`
      )
      await tx.execute(
        sql`INSERT INTO conversation_messages (id,ticket_id,sender_type,content,is_internal) VALUES (gen_random_uuid(),${ticket.id},'agent','Existing ticket',true)`
      )
      const key = `workspace:migration-${person.id}`
      await tx.execute(
        sql`INSERT INTO workspace_assistant_threads (key,owner_principal_id,title) VALUES (${key},${person.id},'Acme')`
      )
      await tx.execute(
        sql`INSERT INTO conversation_messages (id,workspace_thread_key,sender_type,content,is_internal,metadata) VALUES (gen_random_uuid(),${key},'visitor','Hi',true,'{"workspaceTurn":{"runId":"first"}}')`
      )
      const before = await tx.execute(
        sql`SELECT oid,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('workspace_assistant_threads'::regclass,'conversation_messages'::regclass) ORDER BY oid`
      )
      for (const statement of migration) await tx.execute(sql.raw(statement))
      expect(
        await tx.execute(
          sql`SELECT oid,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('workspace_assistant_threads'::regclass,'conversation_messages'::regclass) ORDER BY oid`
        )
      ).toEqual(before)
      expect(
        (
          await tx.execute(
            sql`SELECT content FROM conversation_messages WHERE workspace_thread_key=${key}`
          )
        ).map((row) => row.content)
      ).toEqual(['Hi'])
      expect(
        (
          await tx.execute(
            sql`SELECT content FROM conversation_messages WHERE conversation_id=${conversation.id} OR ticket_id=${ticket.id} ORDER BY content`
          )
        ).map((row) => row.content)
      ).toEqual(['Existing conversation', 'Existing ticket'])
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(
            sql`INSERT INTO conversation_messages (id,conversation_id,workspace_thread_key,sender_type,content,is_internal) VALUES (gen_random_uuid(),${conversation.id},${key},'visitor','Two parents',true)`
          )
        })
      ).rejects.toMatchObject({ cause: { code: '23514' } })
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(
            sql`INSERT INTO conversation_messages (id,workspace_thread_key,sender_type,content,is_internal,metadata) VALUES (gen_random_uuid(),${key},'visitor','Duplicate',true,'{"workspaceTurn":{"runId":"first"}}')`
          )
        })
      ).rejects.toMatchObject({ cause: { code: '23505' } })
      await expect(
        tx.transaction(async (nested) => {
          await nested.execute(
            sql`INSERT INTO conversation_messages (id,workspace_thread_key,sender_type,content,is_internal) VALUES (gen_random_uuid(),${key},'visitor','Public',false)`
          )
        })
      ).rejects.toMatchObject({ cause: { code: '23514' } })
      // Added NOT VALID, then validated: both checks end up enforced on existing rows.
      expect(
        await tx.execute(
          sql`SELECT conname, convalidated FROM pg_constraint WHERE conrelid='conversation_messages'::regclass AND conname IN ('conversation_messages_parent_check','conversation_messages_workspace_internal_check') ORDER BY conname`
        )
      ).toEqual([
        { conname: 'conversation_messages_parent_check', convalidated: true },
        { conname: 'conversation_messages_workspace_internal_check', convalidated: true },
      ])
      // The thread index covers Home rows only, not every message.
      const [index] = await tx.execute(
        sql`SELECT pg_get_indexdef('conversation_messages_workspace_created_idx'::regclass) AS definition`
      )
      expect(index.definition).toContain('WHERE (workspace_thread_key IS NOT NULL)')
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  }
})

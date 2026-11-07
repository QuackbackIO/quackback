import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0311 records which address each kind of email sends from. Every existing
 * address keeps sending what it sent: one address used everywhere becomes the
 * workspace default, and otherwise each module's oldest address becomes that
 * surface's override. The file is applied twice against scratch tables, and the
 * second run must change nothing.
 */
const MIGRATION = readFileSync(join(__dirname, '../../drizzle/0311_email_senders.sql'), 'utf8')
  .replace(/"channel_accounts"/g, '"_m0311_channel_accounts"')
  .replace(/"email_senders/g, '"_m0311_email_senders')

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

type Seed = {
  address: string | null
  role?: string
  module: string | null
  deleted?: boolean
  forwardingTarget?: string
}
type Sender = { surface: string; mode: string; address: string | null }

/** Apply the migration twice over these rows, returning the senders after each run. */
async function backfill(rows: Seed[]): Promise<{ first: Sender[]; second: Sender[] }> {
  let result: { first: Sender[]; second: Sender[] } | null = null
  await db!
    .transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE "_m0311_channel_accounts" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "role" text NOT NULL,
          "address" text,
          "module" text,
          "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "created_at" timestamptz NOT NULL,
          "deleted_at" timestamptz
        )
      `)
      let minute = 0
      for (const r of rows) {
        minute += 1
        await tx.execute(sql`
          INSERT INTO "_m0311_channel_accounts" (role, address, module, config, created_at, deleted_at)
          VALUES (${r.role ?? 'sending'}, ${r.address}, ${r.module},
            ${JSON.stringify(r.forwardingTarget ? { forwardingTarget: r.forwardingTarget } : {})}::jsonb,
            ${new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()}::timestamptz,
            ${r.deleted ? new Date().toISOString() : null}::timestamptz)
        `)
      }
      const read = async () =>
        (await tx.execute<Sender>(sql`
          SELECT s.surface, s.mode, c.address FROM "_m0311_email_senders" s
          LEFT JOIN "_m0311_channel_accounts" c ON c.id = s.channel_account_id
          ORDER BY s.surface
        `)) as unknown as Sender[]
      await tx.execute(sql.raw(MIGRATION))
      const first = [...(await read())]
      await tx.execute(sql.raw(MIGRATION))
      result = { first, second: [...(await read())] }
      throw new Error('rollback')
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === 'rollback') return
      throw err
    })
  return result!
}

describe.skipIf(!dbAvailable)('migration 0311 email senders', () => {
  it('makes one address used everywhere the workspace default', async () => {
    const { first, second } = await backfill([
      { address: 'help@acme.com', module: 'support' },
      { address: 'help@acme.com', module: 'feedback' },
      { address: 'old@acme.com', module: 'feedback', deleted: true },
    ])
    expect(first).toEqual([{ surface: 'default', mode: 'address', address: 'help@acme.com' }])
    expect(second).toEqual(first)
  })

  it('makes a removed address no part of the choice', async () => {
    const { first, second } = await backfill([
      { address: 'help@acme.com', module: 'support' },
      { address: 'old@acme.com', module: 'feedback', deleted: true },
      { address: 'new@acme.com', module: 'changelog', deleted: true },
    ])
    expect(first).toEqual([{ surface: 'default', mode: 'address', address: 'help@acme.com' }])
    expect(second).toEqual(first)
  })

  it("makes each module's oldest address that surface's override", async () => {
    const { first, second } = await backfill([
      { address: 'help@acme.com', module: 'support' },
      { address: 'news@acme.com', module: 'changelog' },
      { address: 'later@acme.com', module: 'support' },
      { address: 'ideas@acme.com', module: 'feedback' },
    ])
    expect(first).toEqual([
      { surface: 'changelog', mode: 'address', address: 'news@acme.com' },
      { surface: 'feedback', mode: 'address', address: 'ideas@acme.com' },
      { surface: 'support', mode: 'address', address: 'help@acme.com' },
    ])
    expect(second).toEqual(first)
  })

  it('replies from the inbox for a workspace that forwards its support inbox here', async () => {
    const { first, second } = await backfill([
      { address: null, role: 'inbound', module: null, forwardingTarget: 'support@acme.com' },
    ])
    expect(first).toEqual([{ surface: 'support', mode: 'inbox', address: null }])
    expect(second).toEqual(first)
  })

  it('keeps one address as the default beside the inbox', async () => {
    const { first, second } = await backfill([
      { address: null, role: 'inbound', module: null, forwardingTarget: 'support@acme.com' },
      { address: 'help@acme.com', module: 'support' },
    ])
    expect(first).toEqual([
      { surface: 'default', mode: 'address', address: 'help@acme.com' },
      { surface: 'support', mode: 'inbox', address: null },
    ])
    expect(second).toEqual(first)
  })

  it('makes the old support address the default when the inbox replaces it', async () => {
    const { first, second } = await backfill([
      { address: null, role: 'inbound', module: null, forwardingTarget: 'support@acme.com' },
      { address: 'help@acme.com', module: 'support' },
      { address: 'news@acme.com', module: 'changelog' },
    ])
    expect(first).toEqual([
      { surface: 'changelog', mode: 'address', address: 'news@acme.com' },
      { surface: 'default', mode: 'address', address: 'help@acme.com' },
      { surface: 'support', mode: 'inbox', address: null },
    ])
    expect(second).toEqual(first)
  })

  it('chooses the inbox for the platform route too, which forwards nothing', async () => {
    const { first } = await backfill([{ address: null, role: 'inbound', module: null }])
    expect(first).toEqual([{ surface: 'support', mode: 'inbox', address: null }])
  })

  it('does not count a removed inbound route', async () => {
    const { first } = await backfill([
      { address: null, role: 'inbound', module: null, deleted: true },
    ])
    expect(first).toEqual([])
  })

  it('writes nothing for a workspace with no sending address', async () => {
    const { first } = await backfill([])
    expect(first).toEqual([])
  })
})

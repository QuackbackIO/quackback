import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0313 records which address each kind of email sends from. Every existing
 * email keeps the sender it had: support and changelog keep their addresses,
 * feedback and status stay on the platform address, and no default is written.
 * The file is applied twice against scratch tables, and the second run must
 * change nothing, even after an admin has cleared a sender in between.
 */
const MIGRATION = readFileSync(join(__dirname, '../../drizzle/0313_email_senders.sql'), 'utf8')
  .replace(/"channel_accounts"/g, '"_m0313_channel_accounts"')
  .replace(/"email_senders/g, '"_m0313_email_senders')

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
async function backfill(
  rows: Seed[],
  between?: string
): Promise<{ first: Sender[]; second: Sender[] }> {
  let result: { first: Sender[]; second: Sender[] } | null = null
  await db!
    .transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE "_m0313_channel_accounts" (
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
          INSERT INTO "_m0313_channel_accounts" (role, address, module, config, created_at, deleted_at)
          VALUES (${r.role ?? 'sending'}, ${r.address}, ${r.module},
            ${JSON.stringify(r.forwardingTarget ? { forwardingTarget: r.forwardingTarget } : {})}::jsonb,
            ${new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()}::timestamptz,
            ${r.deleted ? new Date().toISOString() : null}::timestamptz)
        `)
      }
      const read = async () =>
        (await tx.execute<Sender>(sql`
          SELECT s.surface, s.mode, c.address FROM "_m0313_email_senders" s
          LEFT JOIN "_m0313_channel_accounts" c ON c.id = s.channel_account_id
          ORDER BY s.surface
        `)) as unknown as Sender[]
      await tx.execute(sql.raw(MIGRATION))
      const first = [...(await read())]
      if (between) await tx.execute(sql.raw(between))
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

describe.skipIf(!dbAvailable)('migration 0313 email senders', () => {
  const INBOUND = { address: null, role: 'inbound', module: null } as const

  it('keeps support on its address, and writes no default for the other modules', async () => {
    const { first, second } = await backfill([
      { address: 'help@acme.com', module: 'support' },
      { address: 'help@acme.com', module: 'feedback' },
      { address: 'old@acme.com', module: 'support', deleted: true },
    ])
    expect(first).toEqual([{ surface: 'support', mode: 'address', address: 'help@acme.com' }])
    expect(second).toEqual(first)
  })

  it('leaves a lone changelog address on changelog alone', async () => {
    const { first } = await backfill([{ address: 'news@acme.com', module: 'changelog' }])
    expect(first).toEqual([{ surface: 'changelog', mode: 'address', address: 'news@acme.com' }])
  })

  it("keeps each sending module's oldest address, and feedback on the platform", async () => {
    const { first, second } = await backfill([
      { address: 'help@acme.com', module: 'support' },
      { address: 'news@acme.com', module: 'changelog' },
      { address: 'later@acme.com', module: 'support' },
      { address: 'ideas@acme.com', module: 'feedback' },
      { address: 'gone@acme.com', module: 'changelog', deleted: true },
    ])
    expect(first).toEqual([
      { surface: 'changelog', mode: 'address', address: 'news@acme.com' },
      { surface: 'support', mode: 'address', address: 'help@acme.com' },
    ])
    expect(second).toEqual(first)
  })

  it('replies from the inbox for a workspace that forwards its support inbox here', async () => {
    const { first, second } = await backfill([{ ...INBOUND, forwardingTarget: 'support@acme.com' }])
    expect(first).toEqual([{ surface: 'support', mode: 'inbox', address: null }])
    expect(second).toEqual(first)
  })

  it('replies from the inbox when it forwards a different address than support sends from', async () => {
    const { first } = await backfill([
      { ...INBOUND, forwardingTarget: 'support@acme.com' },
      { address: 'help@acme.com', module: 'support' },
    ])
    expect(first).toEqual([{ surface: 'support', mode: 'inbox', address: null }])
  })

  it('keeps the support address when it is the one forwarded in', async () => {
    const { first } = await backfill([
      { ...INBOUND, forwardingTarget: 'Support@Acme.com' },
      { address: 'support@acme.com', module: 'support' },
    ])
    expect(first).toEqual([{ surface: 'support', mode: 'address', address: 'support@acme.com' }])
  })

  it('keeps the support address beside the platform route, which forwards nothing', async () => {
    const { first } = await backfill([INBOUND, { address: 'help@acme.com', module: 'support' }])
    expect(first).toEqual([{ surface: 'support', mode: 'address', address: 'help@acme.com' }])
  })

  it('chooses the inbox for the platform route alone', async () => {
    const { first } = await backfill([INBOUND])
    expect(first).toEqual([{ surface: 'support', mode: 'inbox', address: null }])
  })

  it('does not count a removed inbound route', async () => {
    const { first } = await backfill([{ ...INBOUND, deleted: true }])
    expect(first).toEqual([])
  })

  it('writes nothing for a workspace with no sending address', async () => {
    const { first } = await backfill([])
    expect(first).toEqual([])
  })

  it('does not write back a sender cleared after it ran', async () => {
    const { first, second } = await backfill(
      [{ address: 'help@acme.com', module: 'support' }],
      'DELETE FROM "_m0311_email_senders"'
    )
    expect(first).toEqual([{ surface: 'support', mode: 'address', address: 'help@acme.com' }])
    expect(second).toEqual([])
  })
})

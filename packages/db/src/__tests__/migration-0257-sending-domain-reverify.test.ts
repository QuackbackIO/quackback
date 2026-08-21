import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0257 demotes every sending domain that was verified before ownership existed.
 *
 * The check those rows passed looked for a TXT record CONTAINING a shared
 * provider's SPF include, plus a CNAME pointing at a constant target. Both are
 * values we publish in the setup instructions, so both are identical for every
 * workspace that follows them, and neither requires control of the zone being
 * claimed. On a fleet where one provider account signs for every workspace,
 * that is not a check.
 *
 * It did not matter while the column was a badge. It matters now that the
 * sending-identity guard reads it as the sole authority for the From address:
 * the same rows that were cosmetically wrong become the thing that decides
 * whether a workspace may send signed as a domain. This migration is what stops
 * that promotion from being a grant.
 *
 * The real migration's statement text is read from disk and run verbatim
 * against a scratch table, so a change to the file that stopped demoting is a
 * failure here rather than a discovery in production. Each case runs inside a
 * transaction that is always rolled back, so dev data is untouched.
 */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0257_sending_domain_reverify.sql'),
  'utf8'
)

/** The same statement, pointed at the scratch table. */
const SCRATCH_SQL = MIGRATION_SQL.replace(
  /"email_sending_domains"/g,
  '"_m0257_email_sending_domains"'
)

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const OWNERSHIP_RECORDS = JSON.stringify([
  {
    type: 'TXT',
    host: '_quackback',
    value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
    purpose: 'ownership',
  },
])

/** What the old check accepted: our SPF line and a constant DKIM target. */
const LEGACY_RECORDS = JSON.stringify([
  { type: 'TXT', host: '@', value: 'v=spf1 include:amazonses.com ~all', purpose: 'spf' },
  { type: 'CNAME', host: 'bounce', value: 'feedback.example.com', purpose: 'return-path' },
])

interface Row {
  domain: string
  status: string
  verified_at: string | null
  last_checked_at: string | null
}

async function withScratch(
  run: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<void>
) {
  if (!db) return
  await db
    .transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE "_m0257_email_sending_domains" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "domain" text NOT NULL,
          "status" text NOT NULL DEFAULT 'pending',
          "dns_records" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "verified_at" timestamptz,
          "last_checked_at" timestamptz,
          "updated_at" timestamptz NOT NULL DEFAULT now()
        )
      `)
      await run(tx)
      throw new Error('rollback')
    })
    .catch((e: Error) => {
      if (e.message !== 'rollback') throw e
    })
}

async function rows(tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<Row[]> {
  const result = await tx.execute<Row>(sql`
    SELECT "domain", "status", "verified_at", "last_checked_at"
    FROM "_m0257_email_sending_domains" ORDER BY "domain"
  `)
  return result as unknown as Row[]
}

describe.skipIf(!dbAvailable)('migration 0257 sending-domain re-verification', () => {
  it('demotes a row verified by the check that could not tell an owner from anyone', async () => {
    await withScratch(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0257_email_sending_domains"
          ("domain", "status", "dns_records", "verified_at", "last_checked_at")
        VALUES ('legacy.example', 'verified', ${LEGACY_RECORDS}::jsonb, now(), now())
      `)

      await tx.execute(sql.raw(SCRATCH_SQL))

      const [row] = await rows(tx)
      expect(row.status).toBe('pending')
      // Cleared with the status: the column records the moment a domain became
      // trustworthy, and this row has never had one. Leaving the stamp would
      // make the next verification look like it had already happened, since the
      // code stamps it only on the pending-to-verified transition.
      expect(row.verified_at).toBeNull()
      // Kept: when we last looked is true, and is not a grant.
      expect(row.last_checked_at).not.toBeNull()
    })
  })

  it('leaves a row that was verified through the ownership token alone', async () => {
    // A database where the guard has already shipped and a domain was verified
    // properly. Demoting it would make every such customer republish nothing
    // and click a button for no reason.
    await withScratch(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0257_email_sending_domains"
          ("domain", "status", "dns_records", "verified_at")
        VALUES ('proved.example', 'verified', ${OWNERSHIP_RECORDS}::jsonb, now())
      `)

      await tx.execute(sql.raw(SCRATCH_SQL))

      const [row] = await rows(tx)
      expect(row.status).toBe('verified')
      expect(row.verified_at).not.toBeNull()
    })
  })

  it('leaves pending and failed rows alone', async () => {
    await withScratch(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0257_email_sending_domains" ("domain", "status", "dns_records")
        VALUES ('a-pending.example', 'pending', ${LEGACY_RECORDS}::jsonb),
               ('b-failed.example', 'failed', ${LEGACY_RECORDS}::jsonb)
      `)

      await tx.execute(sql.raw(SCRATCH_SQL))

      const all = await rows(tx)
      expect(all.map((r) => r.status)).toEqual(['pending', 'failed'])
    })
  })

  it('is replay-safe: a second run changes nothing', async () => {
    // The reconciler can replay a migration against a database whose ledger is
    // behind its schema, so "runs twice" is a real state rather than a
    // hypothetical one.
    await withScratch(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0257_email_sending_domains"
          ("domain", "status", "dns_records", "verified_at")
        VALUES ('legacy.example', 'verified', ${LEGACY_RECORDS}::jsonb, now()),
               ('proved.example', 'verified', ${OWNERSHIP_RECORDS}::jsonb, now())
      `)

      await tx.execute(sql.raw(SCRATCH_SQL))
      const first = await rows(tx)
      await tx.execute(sql.raw(SCRATCH_SQL))
      const second = await rows(tx)

      expect(second).toEqual(first)
      expect(second.map((r) => r.status)).toEqual(['pending', 'verified'])
    })
  })

  it('handles a row with no records at all', async () => {
    // The oldest shape: a domain added before dns_records carried anything.
    await withScratch(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0257_email_sending_domains" ("domain", "status", "verified_at")
        VALUES ('bare.example', 'verified', now())
      `)

      await tx.execute(sql.raw(SCRATCH_SQL))

      const [row] = await rows(tx)
      expect(row.status).toBe('pending')
    })
  })
})

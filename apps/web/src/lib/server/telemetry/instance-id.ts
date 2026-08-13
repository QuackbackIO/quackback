import { randomUUID } from 'crypto'

/**
 * Get or create a stable instance ID stored in the settings.metadata JSON.
 * This avoids adding a new table — reuses the existing metadata column.
 *
 * ## Why this writes one key instead of the whole bag
 *
 * `settings.metadata` is a shared `text` column holding a JSON object that
 * several unrelated things keep their state in, and one of them is the control
 * plane's `cloudTenant` stamp — the fact `workspaces/provenance.ts` reads to
 * decide whether arriving at a workspace is a way to take ownership of it. On
 * workspaces provisioned by current code that stamp lives ONLY here.
 *
 * Reading the bag into memory, adding a key and writing the whole object back
 * is a read-modify-write with no lock and no compare: anything written to any
 * other key between the read and the write is silently discarded. This runs
 * unattended and hourly, so it is the writer most likely to be the one holding
 * a stale copy, and losing that race would leave a provisioned workspace
 * reading as self-hosted permanently. `fingerprint.ts` names this exact
 * function as the reason the dedicated column was introduced.
 *
 * So the write is a single statement that merges its own key server-side and
 * touches nothing else, conditioned on the key still being absent. Concurrent
 * callers converge: the loser's `WHERE` no longer matches and it reads back the
 * winner's value.
 */
export async function getOrCreateInstanceId(): Promise<string> {
  try {
    const { db, settings, eq, sql } = await import('@/lib/server/db')

    const org = await db.query.settings.findFirst({ columns: { id: true, metadata: true } })
    if (!org) return randomUUID()
    const existing = readInstanceIdFrom(org.metadata)
    if (existing) return existing

    const instanceId = randomUUID()
    // `NULLIF(...,'')` so an empty string is treated as an absent bag rather
    // than raising on the cast. A bag that is present but malformed DOES raise,
    // and that is the right outcome: it aborts this write rather than replacing
    // whatever is in there with a fresh object containing only our key.
    await db.execute(sql`
      UPDATE settings
         SET metadata = (
               COALESCE(NULLIF(metadata, '')::jsonb, '{}'::jsonb)
               || jsonb_build_object('instanceId', ${instanceId}::text)
             )::text
       WHERE ${eq(settings.id, org.id)}
         AND COALESCE(NULLIF(metadata, '')::jsonb, '{}'::jsonb) ->> 'instanceId' IS NULL
    `)

    // Read back rather than trusting our own value: if a concurrent caller won,
    // the row holds theirs and this process must report the same one.
    const after = await db.query.settings.findFirst({ columns: { metadata: true } })
    return readInstanceIdFrom(after?.metadata) ?? instanceId
  } catch {
    // If DB fails, return a random UUID (won't persist but won't crash)
    return randomUUID()
  }
}

/** The stored id, or null when the bag is absent, unreadable, or has no id. */
function readInstanceIdFrom(metadata: string | null | undefined): string | null {
  if (!metadata) return null
  try {
    const bag = JSON.parse(metadata) as Record<string, unknown>
    return typeof bag.instanceId === 'string' ? bag.instanceId : null
  } catch {
    return null
  }
}

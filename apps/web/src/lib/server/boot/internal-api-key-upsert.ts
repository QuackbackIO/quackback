/**
 * Stage 1C: ensure an `api_keys` row matching the projected
 * `INTERNAL_API_KEY` env var exists in this workspace's DB.
 *
 * The OSS pod, when running under cloud, receives `INTERNAL_API_KEY`
 * via OpenBao → ESO → Secret env. CP needs that key to authenticate
 * its calls into `/api/v1/internal/*` (today: tier-limits, usage).
 *
 * Until Stage 1E retires the duckpond `tenant-bootstrap` Job, the
 * Job's `seed-internal-api-key.sh` script also INSERTs this row.
 * That insert and this upsert race on every boot. Both write the
 * same row (same key_hash); whichever wins, the other no-ops via
 * `ON CONFLICT (key_hash) DO NOTHING`.
 *
 * For self-hosters: the env var is unset and this function is a
 * no-op. The OSS-unaware invariant holds — OSS only ever observes
 * a generic env var, not "cloud."
 */

import { createHash } from 'node:crypto'
import { db, apiKeys, principal, eq } from '@/lib/server/db'

/** qb_ + 48 hex chars */
const KEY_REGEX = /^qb_[0-9a-f]{48}$/

const PREFIX_LOOKUP_LEN = 12
const SCOPE_INTERNAL_TIER_LIMITS = 'internal:tier-limits'

function hash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function upsertInternalApiKey(): Promise<void> {
  const key = process.env.INTERNAL_API_KEY
  if (!key) return
  if (!KEY_REGEX.test(key)) {
    // Bad format — silent no-op rather than throw, so a fat-fingered
    // operator env tweak doesn't block the entire boot.
    return
  }

  try {
    const keyHash = hash(key)
    const keyPrefix = key.slice(0, PREFIX_LOOKUP_LEN)

    // Idempotent fast-path: if a row already exists for this hash,
    // we have nothing to do. Avoids creating an orphan service
    // principal on every boot.
    const existing = await db.query.apiKeys.findFirst({
      where: (t, { eq }) => eq(t.keyHash, keyHash),
    })
    if (existing) return

    // Create the service principal that owns this key. Row content
    // intentionally MATCHES the duckpond seed-internal-api-key.sh
    // INSERT (role='member', displayName='Quackback Cloud Control Plane',
    // api_keys.name='cp-internal') so that during the Stage 1A→1E
    // transition window — both writers active — whichever wins, the
    // resulting row is identical.
    //
    // serviceMetadata.apiKeyId is filled in after the api_keys row
    // is INSERTed below — same chicken-and-egg pattern as
    // createApiKey() in api-key.service.ts.
    const [createdPrincipal] = await db
      .insert(principal)
      .values({
        userId: null,
        type: 'service',
        role: 'member',
        displayName: 'Quackback Cloud Control Plane',
        serviceMetadata: { kind: 'api_key', apiKeyId: '' },
        createdAt: new Date(),
      })
      .returning()

    if (!createdPrincipal) return

    // Insert the api_keys row. Race with the duckpond seed Job is
    // resolved by ON CONFLICT DO NOTHING on the keyHash unique index.
    // Empty returning() = the seed Job got there first; that's fine,
    // a row with this hash exists, so the orphan principal is the
    // only cost (cleaned up by the existence check on next boot).
    const [createdKey] = await db
      .insert(apiKeys)
      .values({
        name: 'cp-internal',
        keyHash,
        keyPrefix,
        createdById: null,
        principalId: createdPrincipal.id,
        scopes: JSON.stringify([SCOPE_INTERNAL_TIER_LIMITS]),
      })
      .onConflictDoNothing()
      .returning()

    if (createdKey) {
      // Backfill the principal's serviceMetadata with the actual key id.
      await db
        .update(principal)
        .set({ serviceMetadata: { kind: 'api_key', apiKeyId: createdKey.id } })
        .where(eq(principal.id, createdPrincipal.id))
    }
  } catch (err) {
    // Boot must not block on this. A DB outage at boot time is
    // already surfaced through the normal liveness/readiness path;
    // duplicating it here would only delay startup. The next boot
    // retries from cold.
    console.warn('[boot] upsertInternalApiKey failed', { err: String(err) })
  }
}

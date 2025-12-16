import { sql } from 'drizzle-orm'
import { db, getDb, type Database } from './client'
import { toUuid, type OrgId } from '@quackback/ids'

// Re-export db and Database type for consumers
export { db, getDb, type Database }

/**
 * Admin database access without RLS restrictions.
 * Use for webhook handlers and system-level operations that need
 * to bypass tenant isolation (e.g., Stripe webhooks creating subscriptions).
 *
 * IMPORTANT: Only use this for operations that cannot use tenant context.
 */
export const adminDb = db

// UUID regex pattern for validation (prevents SQL injection)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateUuid(uuid: string): void {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error(`Invalid UUID format: ${uuid}`)
  }
}

/**
 * Creates a tenant-scoped database transaction.
 * Sets the app.organization_id session variable before executing queries.
 * All RLS policies will automatically filter by this organization.
 */
export async function withTenantContext<T>(
  organizationId: OrgId,
  callback: (tx: Database) => Promise<T>
): Promise<T> {
  // Convert TypeID to raw UUID for RLS policy
  const uuid = toUuid(organizationId)
  validateUuid(uuid)
  return db.transaction(async (tx) => {
    // Note: SET LOCAL doesn't support parameterized queries in PostgreSQL,
    // so we use sql.raw() with validated UUID to prevent SQL injection
    await tx.execute(sql.raw(`SET LOCAL app.organization_id = '${uuid}'`))
    await tx.execute(sql`SET LOCAL ROLE app_user`)
    return callback(tx as unknown as Database)
  })
}

/**
 * Sets tenant context for a single query (when not using transactions).
 * Prefer withTenantContext for multiple queries.
 */
export async function setTenantContext(organizationId: OrgId): Promise<void> {
  // Convert TypeID to raw UUID for RLS policy
  const uuid = toUuid(organizationId)
  validateUuid(uuid)
  // Note: SET doesn't support parameterized queries in PostgreSQL,
  // so we use sql.raw() with validated UUID to prevent SQL injection
  await db.execute(sql.raw(`SET app.organization_id = '${uuid}'`))
  await db.execute(sql`SET ROLE app_user`)
}

/**
 * Clears the tenant context (resets to default role).
 * Use after setTenantContext if you need to run admin queries.
 */
export async function clearTenantContext(): Promise<void> {
  await db.execute(sql`RESET app.organization_id`)
  await db.execute(sql`RESET ROLE`)
}

import { sql } from 'drizzle-orm'
import { db, type Database } from './client'

// Re-export db and Database type for consumers
export { db, type Database }

/**
 * Creates a tenant-scoped database transaction.
 * Sets the app.organization_id session variable before executing queries.
 * All RLS policies will automatically filter by this organization.
 */
export async function withTenantContext<T>(
  organizationId: string,
  callback: (tx: Database) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.organization_id = ${organizationId}`)
    await tx.execute(sql`SET LOCAL ROLE app_user`)
    return callback(tx as unknown as Database)
  })
}

/**
 * Sets tenant context for a single query (when not using transactions).
 * Prefer withTenantContext for multiple queries.
 */
export async function setTenantContext(organizationId: string): Promise<void> {
  await db.execute(sql`SET app.organization_id = ${organizationId}`)
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

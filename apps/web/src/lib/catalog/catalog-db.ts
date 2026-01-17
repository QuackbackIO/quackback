/**
 * Catalog Database Connection
 *
 * Provides a singleton connection to the catalog database using neon-http.
 * Used by tenant resolver and domain service for lightweight queries.
 *
 * Note: get-started.ts uses postgres driver instead for migration support.
 */

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { catalogSchema } from './schema'

export type CatalogDb = ReturnType<typeof drizzle<typeof catalogSchema>>

let catalogDb: CatalogDb | null = null

/**
 * Get the catalog database connection.
 * Creates a singleton instance using neon-http driver.
 */
export function getCatalogDb(): CatalogDb {
  const url = process.env.CLOUD_CATALOG_DATABASE_URL
  if (!url) {
    throw new Error('CLOUD_CATALOG_DATABASE_URL is required')
  }

  if (!catalogDb) {
    const sql = neon(url)
    catalogDb = drizzle(sql, { schema: catalogSchema })
  }
  return catalogDb
}

/** Reset catalog db connection (for testing) */
export function resetCatalogDb(): void {
  catalogDb = null
}

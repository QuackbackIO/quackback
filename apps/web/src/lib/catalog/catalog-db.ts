import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { catalogSchema } from './schema'

export type CatalogDb = ReturnType<typeof drizzle<typeof catalogSchema>>

export function getCatalogDb(): CatalogDb {
  const url = process.env.CLOUD_CATALOG_DATABASE_URL
  if (!url) {
    throw new Error('CLOUD_CATALOG_DATABASE_URL is required')
  }

  const sql = neon(url)
  return drizzle(sql, { schema: catalogSchema })
}

export function resetCatalogDb(): void {}

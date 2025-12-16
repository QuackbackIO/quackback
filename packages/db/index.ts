// Client and tenant context
export { db, getDb, type Database } from './src/tenant-context'
export { withTenantContext, setTenantContext, clearTenantContext } from './src/tenant-context'

// Unit of Work
export { UnitOfWork, withUnitOfWork } from './src/unit-of-work'

// Crypto utilities for integration tokens
export { encryptToken, decryptToken } from './src/crypto'

// Repositories
export * from './src/repositories'

// Schema
export * from './src/schema'

// Types
export * from './src/types'

// Re-export common drizzle-orm utilities
export {
  eq,
  and,
  or,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  sql,
  desc,
  asc,
} from 'drizzle-orm'

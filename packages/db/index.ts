// Client and tenant context
export { db, type Database } from './src/tenant-context'
export { withTenantContext, setTenantContext, clearTenantContext } from './src/tenant-context'

// Unit of Work
export { UnitOfWork, withUnitOfWork } from './src/unit-of-work'

// Repositories
export * from './src/repositories'

// Schema
export * from './src/schema'

// Types
export * from './src/types'

// Queries (legacy - kept for backward compatibility)
export * from './src/queries/boards'
export * from './src/queries/posts'
export * from './src/queries/comments'
export * from './src/queries/statuses'
export * from './src/queries/members'
export * from './src/queries/public'

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

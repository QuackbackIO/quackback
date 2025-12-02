// Client and tenant context
export { db } from './src/tenant-context'
export {
  withTenantContext,
  setTenantContext,
  clearTenantContext,
} from './src/tenant-context'

// Schema
export * from './src/schema'

// Types
export * from './src/types'

// Queries
export * from './src/queries/boards'
export * from './src/queries/roadmaps'
export * from './src/queries/posts'
export * from './src/queries/integrations'
export * from './src/queries/changelog'

// Re-export common drizzle-orm utilities
export { eq, and, or, ne, gt, gte, lt, lte, like, ilike, inArray, notInArray, isNull, isNotNull, sql, desc, asc } from 'drizzle-orm'

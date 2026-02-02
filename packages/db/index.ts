// Database client
export { createDb, getMigrationDb, type Database, type CreateDbOptions } from './src/client'

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
  count,
  sum,
  avg,
  min,
  max,
} from 'drizzle-orm'

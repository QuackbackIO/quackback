// Database client — import from '@quackback/db/client' directly to avoid
// pulling postgres into the client bundle via Vite's module scanner.
export type { Database, CreateDbOptions } from './src/client'

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

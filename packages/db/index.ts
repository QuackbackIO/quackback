// Database client
export { createDb, getMigrationDb, type Database, type CreateDbOptions } from './src/client'

// Crypto utilities for integration tokens
export { encryptToken, decryptToken } from './src/crypto'

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

/**
 * Tag domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './tag.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { TagError, type TagErrorCode } from './tag.errors'

// Types (no DB dependency)
export type { CreateTagInput, UpdateTagInput } from './tag.types'

/**
 * Status domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './status.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { StatusError, type StatusErrorCode } from './status.errors'

// Types (no DB dependency)
export type {
  Status,
  CreateStatusInput,
  UpdateStatusInput,
  ReorderStatusesInput,
} from './status.types'

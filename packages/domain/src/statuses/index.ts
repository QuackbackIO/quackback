/**
 * Status domain module
 *
 * This module exports all status-related domain types, services, and errors.
 */

// Export service
export { StatusService, statusService } from './status.service'

// Export errors
export { StatusError, type StatusErrorCode } from './status.errors'

// Export types
export type {
  Status,
  CreateStatusInput,
  UpdateStatusInput,
  ReorderStatusesInput,
} from './status.types'

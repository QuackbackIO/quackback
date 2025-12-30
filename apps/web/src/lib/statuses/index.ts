/**
 * Status domain module
 *
 * This module exports all status-related domain types, services, and errors.
 */

// Export service functions
export {
  createStatus,
  updateStatus,
  deleteStatus,
  getStatusById,
  listStatuses,
  reorderStatuses,
  setDefaultStatus,
  getDefaultStatus,
  getStatusBySlug,
  listPublicStatuses,
} from './status.service'

// Export errors
export { StatusError, type StatusErrorCode } from './status.errors'

// Export types
export type {
  Status,
  CreateStatusInput,
  UpdateStatusInput,
  ReorderStatusesInput,
} from './status.types'

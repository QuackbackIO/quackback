/**
 * Shared processor logic exports.
 *
 * These processors contain the business logic for job processing,
 * decoupled from the job infrastructure (BullMQ or Cloudflare Workflows).
 */

// Import processor
export {
  parseCSV,
  validateJobData,
  processBatch,
  mergeResults,
  processImport,
  BATCH_SIZE,
  MAX_ERRORS,
  MAX_TAGS_PER_POST,
  type BatchResult,
} from './import'

// Integration processor
export { loadIntegrationConfig, recordSyncLog, processIntegration } from './integration'

// User notification processor
export { processUserNotification } from './user-notification'

// Event processor (unified event handling)
export {
  processEvent,
  processSingleIntegration,
  processEventNotifications,
  getIntegrationMappings,
  isNotificationEvent,
  type IntegrationMapping,
} from './event'

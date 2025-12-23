// Connection utilities
export { getConnection, getConnectionOptions, createRedisClient } from './connection'

// Types
export {
  JobTypes,
  type JobType,
  type ImportJobData,
  type ImportJobProgress,
  type ImportRowError,
  type ImportJobResult,
  type ImportJobStatus,
  type DomainEventPayload,
  type IntegrationJobData,
  type IntegrationJobResult,
  type UserNotificationJobData,
  type UserNotificationJobResult,
  // Event types
  type EventType,
  type EventJobData,
  type EventJobResult,
  type EventActor,
  // Event payload types
  type EventPostData,
  type EventPostRef,
  type EventCommentData,
  type PostCreatedPayload,
  type PostStatusChangedPayload,
  type CommentCreatedPayload,
  type EventPayloadMap,
  // Specific event job data types (for discriminated union)
  type PostCreatedEventJobData,
  type PostStatusChangedEventJobData,
  type CommentCreatedEventJobData,
  // Helper types
  type EventPayloadFor,
  type EventJobDataFor,
} from './types'

// Adapters
export {
  // Adapter factories
  getJobAdapter,
  getStateAdapter,
  closeAdapters,
  // Types
  type JobAdapter,
  type StateAdapter,
  type CircuitState,
  // Config
  CIRCUIT_BREAKER_CONFIG,
  IDEMPOTENCY_CONFIG,
  QueueNames,
  // Direct functions (for convenience)
  addImportJob,
  getImportJobStatus,
  addEventJob,
  canExecute,
  recordSuccess,
  recordFailure,
  isProcessed,
  markProcessed,
  getProcessedResult,
  cacheGet,
  cacheSet,
  cacheDel,
} from './adapters'

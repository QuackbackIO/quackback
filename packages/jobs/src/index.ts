// Connection utilities (for BullMQ/Redis)
export { getConnection, getConnectionOptions, createRedisClient } from './connection'

// Queue utilities (BullMQ - for backwards compatibility and OSS)
export { QueueNames, getImportQueue, addImportJob, getImportJobStatus, closeQueues } from './queues'

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

// Adapters (use these for new code)
export {
  getJobAdapter,
  getStateAdapter,
  closeAdapters,
  type JobAdapter,
  type StateAdapter,
} from './adapters'

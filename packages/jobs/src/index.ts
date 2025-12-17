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
  type EventType,
  type EventJobData,
  type EventJobResult,
} from './types'

// Adapters (use these for new code)
export {
  getJobAdapter,
  getStateAdapter,
  closeAdapters,
  isCloudflareWorker,
  type JobAdapter,
  type StateAdapter,
  type CloudflareEnv,
} from './adapters'

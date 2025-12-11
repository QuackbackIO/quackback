// Connection utilities
export { getConnection, getConnectionOptions, createRedisClient } from './connection'

// Queue utilities
export {
  QueueNames,
  getImportQueue,
  addImportJob,
  getImportJobStatus,
  getIntegrationsQueue,
  addIntegrationJob,
  closeQueues,
} from './queues'

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
} from './types'

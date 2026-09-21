import type { SyncErrorCode, SyncState } from '@/lib/shared/integration-sync'
import type { integrationSyncOperations } from '@/lib/server/db'

export type SyncOperation = typeof integrationSyncOperations.$inferSelect
export type SyncExecutor =
  | 'hook'
  | 'refresh'
  | 'ticket-create'
  | 'inbound-status'
  | 'inbound-webhook'
  | 'identify'
  | 'segment'
  | 'archive'
  | 'app-hook'
export interface SyncPayload {
  executor: SyncExecutor
  data: Record<string, unknown>
  reconcileOnly?: boolean
}
export type SyncOutcome =
  | { state: 'succeeded'; result?: Record<string, unknown> }
  | {
      state:
        | 'retry_wait'
        | 'failed'
        | 'auth_required'
        | 'uncertain'
        | 'conflict'
        | 'cancelled'
        | 'superseded'
      errorCode?: SyncErrorCode
      retryAfterMs?: number
    }
export interface SyncIntent {
  operationKey: string
  integrationId: string
  installation: string
  provider: string
  direction: 'inbound' | 'outbound'
  kind: string
  sourceType: string
  sourceId: string
  sourceRevision?: string
  destination: Record<string, unknown>
  remoteId?: string
  requestedBy?: string
  payload: SyncPayload
  result?: Record<string, unknown>
  state?: SyncState
  errorCode?: SyncErrorCode
}
export interface SyncClaim {
  operation: SyncOperation
  token: string
}

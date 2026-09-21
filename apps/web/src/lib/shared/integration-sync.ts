/** Safe wire contract. Provider errors and operation payloads never cross it. */
export const SYNC_STATES = [
  'queued',
  'running',
  'retry_wait',
  'failed',
  'auth_required',
  'uncertain',
  'conflict',
  'succeeded',
  'cancelled',
  'superseded',
] as const
export type SyncState = (typeof SYNC_STATES)[number]
export type SyncAction = 'retry' | 'cancel' | 'reconcile' | 'keep_remote' | 'link_existing'
export type SyncFilter = 'all' | 'attention' | 'progress' | 'successful'
export const SYNC_ERRORS = {
  provider_failed: 'The platform rejected this change. Review the configuration before retrying.',
  unavailable: 'The platform is temporarily unavailable.',
  authentication:
    'Check this integration’s credentials before retrying. A replacement connection requires a new sync.',
  outcome_unknown:
    'The platform may have applied this change. Check the remote item before taking further action.',
  content_conflict: 'Remote content has changed since the last sync.',
  manual_update: 'Review and apply this change on the platform to preserve edits made there.',
  missing_baseline: 'We could not verify this change. Check the platform before continuing.',
  source_unavailable: 'This item was removed or is no longer available to sync.',
  cancelled_by_user: 'Further attempts were cancelled by a teammate.',
  installation_changed:
    'The connection or destination changed. This operation cannot use the new connection.',
  missing_payload: 'The original data is no longer available. Start a new sync from the source.',
  local_persistence: 'The remote change succeeded; local confirmation still needs to be saved.',
} as const
export type SyncErrorCode = keyof typeof SYNC_ERRORS
export const SYNC_ATTENTION: readonly SyncState[] = [
  'failed',
  'auth_required',
  'uncertain',
  'conflict',
]
export const SYNC_LABELS: Record<SyncState, string> = {
  queued: 'Queued',
  running: 'Syncing',
  retry_wait: 'Retry scheduled',
  failed: 'Failed',
  auth_required: 'Authentication required',
  uncertain: 'Outcome unknown',
  conflict: 'Needs review',
  succeeded: 'Successful',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
}
export const SYNC_KIND_LABELS: Record<string, string> = {
  create: 'Create item',
  refresh: 'Update content',
  status: 'Update status',
  'receive-status': 'Status received',
  'receive-webhook': 'Webhook received',
  membership: 'Segment membership',
  identify: 'Update user',
  archive: 'Archive item',
  'app-hook': 'App event',
  notify: 'Notification',
  link: 'Link existing item',
}
export interface SyncHistoryItem {
  id: string
  provider: string
  direction: 'inbound' | 'outbound'
  kind: string
  state: SyncState
  version: number
  sourceType: string
  sourceId: string | null
  sourceTitle: string | null
  remoteUrl: string | null
  remoteDisplayId: string | null
  destinationLabel?: string | null
  attempts: number
  error: string | null
  cancelRequested: boolean
  createdAt: string
  updatedAt: string
  actions: SyncAction[]
}

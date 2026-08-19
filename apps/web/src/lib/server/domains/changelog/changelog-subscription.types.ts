/**
 * Input/Output types for the changelog subscriber pipeline.
 */
import type { PrincipalId } from '@quackback/ids'
import type { ChangelogSubscriptionSource } from '@/lib/server/db'

export type { ChangelogSubscriptionSource }

export interface ChangelogSubscriptionStatus {
  principalId: PrincipalId
  subscribed: boolean
  source: ChangelogSubscriptionSource | null
  unsubscribedAt: Date | null
}

export interface ChangelogCsvImportResult {
  imported: number
  /** Rows whose email didn't match an existing user account. */
  skipped: number
  total: number
}

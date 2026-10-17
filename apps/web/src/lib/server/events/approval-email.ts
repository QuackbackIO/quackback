import type { AssistantPendingActionId } from '@quackback/ids'
import { getPendingActionById } from '@/lib/server/domains/assistant/pending-actions.service'
import {
  digestForDisplay,
  listEligibleDeciders,
} from '@/lib/server/domains/assistant/approvals.service'
import { batchGetNotificationPreferences } from '@/lib/server/domains/subscriptions/subscription.service'
import { shouldNotify } from '@/lib/server/domains/subscriptions/notification-matrix'
import { resolveContactRecipients } from '@/lib/server/email/recipient'
import { emailTarget } from './targets'
import type { EventData } from './types'
import type { HookContext } from './hook-context'
import type { HookTarget } from './hook-types'

/** Eligibility and preferences are read when the durable event is dispatched. */
export async function getApprovalEmailTargets(
  event: EventData,
  context: HookContext
): Promise<HookTarget[]> {
  if (event.type !== 'approval.requested') return []
  const row = await getPendingActionById(event.data.approvalId as AssistantPendingActionId)
  if (!row) return []
  const ids = await listEligibleDeciders(row)
  if (ids.length === 0) return []
  const [addresses, preferences, digest] = await Promise.all([
    resolveContactRecipients(ids),
    batchGetNotificationPreferences(ids),
    digestForDisplay(row),
  ])
  const query = new URLSearchParams({ id: row.id, d: digest, source: 'email' })
  return ids.flatMap((id) => {
    const address = addresses.get(id)
    const prefs = preferences.get(id)
    if (!address || !prefs || !shouldNotify(prefs, 'approval_requested', 'email')) return []
    return [
      {
        ...emailTarget(address, '', {
          approvalId: row.id,
          summary: row.summary,
          reviewUrl: `${context.portalBaseUrl}/admin/approvals/confirm?${query}`,
          workspaceName: context.workspaceName,
          preferencesUrl: `${context.portalBaseUrl}/admin/settings/notifications`,
          logoUrl: context.logoUrl ?? undefined,
        }),
        deliveryKey: `approval:${row.id}:${id}:email`,
      },
    ]
  })
}

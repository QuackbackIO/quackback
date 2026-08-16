/**
 * Close-spam harvest: when Quinn classifies a conversation as spam (select
 * key `spam`, option label `Spam`) and the workspace setting is on, close
 * via a bounded service actor — the same close a workflow `close` action
 * uses, not the inbound spam-file primitive. A service-actor close is what
 * W3 already maps onto the escalated assistant-wait edge. Only call after
 * AI-sourced attribute writes land — teammate-authored flips must never
 * reach this function.
 */
import type { ConversationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { AUTOMATION_PERMISSIONS } from '@/lib/server/domains/workflows/workflow-actor-permissions'
import { getWorkflowCloseSpamSettings } from '@/lib/server/domains/settings/settings.workflows'

const log = logger.child({ component: 'close-if-spam' })

export function isSpamClassification(
  applied: ReadonlyArray<{ key: string; optionLabel: string }>
): boolean {
  return applied.some((a) => a.key === 'spam' && a.optionLabel === 'Spam')
}

export async function maybeCloseConversationIfSpamClassified(
  conversationId: ConversationId,
  applied: ReadonlyArray<{ key: string; optionLabel: string }>
): Promise<void> {
  if (!isSpamClassification(applied)) return
  const settings = await getWorkflowCloseSpamSettings()
  if (!settings.enabled) return

  try {
    const { setConversationStatus } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await setConversationStatus(
      conversationId,
      'closed',
      boundedServiceActor(AUTOMATION_PERMISSIONS)
    )
  } catch (err) {
    log.warn({ err, conversationId }, 'close-spam failed')
  }
}

/**
 * Removing ticket <-> external issue links, singly (an agent's unlink, in
 * ticket-external-links.service) or all at once for one destination (a
 * repository that stops being synced). Every removal leaves the same
 * team-only 'external_unlinked' note on the ticket thread.
 */
import { db, eq, and, ticketExternalLinks, type Transaction } from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'
import { getIntegration } from '@/lib/server/integrations'
import { logger } from '@/lib/server/logger'
import { emitTicketSystemMessage } from './ticket-message.service'

const log = logger.child({ component: 'ticket-external-links' })

/** The team-only 'external_unlinked' note for a link just removed. */
export async function noteUnlinked(
  removed: typeof ticketExternalLinks.$inferSelect,
  tx: Transaction
): Promise<void> {
  const reference = removed.externalDisplayId ?? removed.externalId
  const provider = getIntegration(removed.integrationType)?.catalog.name ?? removed.integrationType
  await emitTicketSystemMessage(
    removed.ticketId,
    'external_unlinked',
    `Unlinked ${provider} issue ${reference}`,
    {
      metadata: { externalReference: reference, externalUrl: removed.externalUrl ?? undefined },
      exec: tx,
    }
  )
  log.info({ ticket_id: removed.ticketId, link_id: removed.id }, 'ticket external link removed')
}

/**
 * Remove every ticket link a connection made on one destination (by its
 * `sync_scope`), as when a repository stops being synced. Returns how many
 * links were removed.
 */
export async function unlinkTicketLinksInScope(
  integrationId: IntegrationId,
  syncScope: string
): Promise<number> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(ticketExternalLinks)
      .where(
        and(
          eq(ticketExternalLinks.integrationId, integrationId),
          eq(ticketExternalLinks.syncScope, syncScope)
        )
      )
      .returning()
    for (const link of removed) await noteUnlinked(link, tx)
    return removed.length
  })
}

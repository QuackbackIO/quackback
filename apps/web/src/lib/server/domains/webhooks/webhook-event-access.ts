/**
 * Who may subscribe a webhook to which events.
 *
 * A webhook receives each event's payload, so subscribing is a read of every
 * event on the list. It needs what reading that event needs anywhere else:
 *
 * - the event's read scope on an API key, the same check app webhooks make
 *   (`appMatches` in events/resolvers/app-webhook.resolver.ts);
 * - one of the event category's view permissions on the person, the key's
 *   creator or the signed-in teammate.
 *
 * Without this, a Feedback-only key, or a role with `webhook.manage` but no
 * inbox access, could subscribe to internal notes and ticket replies it can
 * never read. Checked on create, on an event change, and on a URL change (so a
 * webhook cannot be pointed at a new endpoint by someone who could not have
 * created it). Pausing, resuming and deleting are not re-checked.
 */
import { hasApiScope, viewPermissionsForCategory } from '@/lib/shared/api-key-scopes'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { getEventDefinition } from '@/lib/server/events/catalogue'
import type { WebhookId } from '@quackback/ids'

export interface WebhookSubscriber {
  /** The key's stored scopes; null for a legacy full-access key or a signed-in teammate. */
  scopes: readonly string[] | null
  /** The person's current permissions (the key's creator, or the teammate). */
  permissions: Iterable<PermissionKey>
}

/** Refuse the first event the subscriber may not read. */
export function assertCanSubscribeToEvents(
  events: readonly string[],
  subscriber: WebhookSubscriber
): void {
  const held = new Set(subscriber.permissions)
  for (const event of events) {
    const definition = getEventDefinition(event)
    if (!definition) {
      throw new ValidationError('VALIDATION_ERROR', `Unknown webhook event '${event}'`)
    }
    if (!hasApiScope(subscriber.scopes, definition.requiredScope)) {
      throw new ForbiddenError(
        'FORBIDDEN',
        `This API key is missing the '${definition.requiredScope}' scope required by the '${event}' event`
      )
    }
    const viewPermissions = viewPermissionsForCategory(definition.category)
    if (viewPermissions.length > 0 && !viewPermissions.some((p) => held.has(p))) {
      throw new ForbiddenError(
        'FORBIDDEN',
        `Subscribing to '${event}' requires the ${viewPermissions
          .map((p) => `'${p}'`)
          .join(' or ')} permission`
      )
    }
  }
}

/**
 * Check an update: new events are checked as on create, and a new URL
 * re-checks the events the webhook already carries. A change to neither
 * (status, board filter) needs no event access.
 */
export async function assertCanUpdateWebhookEvents(
  webhookId: WebhookId,
  change: { url?: string; events?: readonly string[] },
  subscriber: WebhookSubscriber
): Promise<void> {
  if (change.events) {
    assertCanSubscribeToEvents(change.events, subscriber)
    return
  }
  if (change.url === undefined) return
  const { getWebhookById } = await import('./webhook.service')
  const current = await getWebhookById(webhookId)
  assertCanSubscribeToEvents(current.events, subscriber)
}

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
 * never read. Checked on create, for events added on update, and for every
 * event when the URL changes. Pausing, resuming and deleting are not
 * re-checked.
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
 * Check an update. Events being added are checked as on create. A new URL
 * re-checks every event the webhook will carry, so it cannot be pointed at a
 * new endpoint by someone who could not have created it. Resending the stored
 * URL and events (as the edit dialog does on every save), pausing, or changing
 * the board filter needs no event access.
 */
export async function assertCanUpdateWebhookEvents(
  webhookId: WebhookId,
  change: { url?: string; events?: readonly string[] },
  subscriber: WebhookSubscriber
): Promise<void> {
  if (change.events === undefined && change.url === undefined) return
  const { getWebhookById } = await import('./webhook.service')
  const current = await getWebhookById(webhookId)
  const events = change.events ?? current.events
  const repointed = change.url !== undefined && change.url !== current.url
  const toCheck = repointed ? events : events.filter((e) => !current.events.includes(e))
  assertCanSubscribeToEvents(toCheck, subscriber)
}

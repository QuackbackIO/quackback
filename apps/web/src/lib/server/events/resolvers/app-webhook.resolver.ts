/**
 * App-webhook resolver (EVENTING-V2 §3.6 / WO-13). The third-party extension
 * sink: for each active app subscribed to the event type, emit a signed-delivery
 * target — but ONLY if the app's granted_scopes include the catalogue def's
 * requiredScope. Subscription authorization is thus a scope check against the
 * vocabulary already shared by REST/MCP/OAuth; no new authz axis.
 *
 * Delivery goes through the 'app_webhook' hook (HMAC-signed, safeFetch,
 * hook_deliveries idempotency) — the same substrate as customer webhooks.
 */
import { db, apps, oauthClient, and, eq } from '@/lib/server/db'
import { getEventDefinition } from '../catalogue'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

/** Pure subscription + scope gate (unit-tested). */
export function appMatches(
  app: {
    status: string
    webhookEndpoint: string | null
    subscribedEventTypes: string[]
    grantedScopes: string[]
  },
  eventType: string,
  requiredScope: string | undefined
): boolean {
  if (app.status !== 'active') return false
  if (!app.webhookEndpoint) return false
  if (!app.subscribedEventTypes.includes(eventType)) return false
  // Scope gate: the app must hold the event's required scope. An event with no
  // requiredScope (shouldn't happen — the catalogue mandates one) is denied.
  if (!requiredScope) return false
  if (!app.grantedScopes.includes(requiredScope)) return false
  return true
}

export const appWebhookResolver: SinkResolver = {
  sink: 'app_webhook',
  interestedIn(type: string): boolean {
    return getEventDefinition(type) !== undefined
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    const requiredScope = getEventDefinition(event.type)?.requiredScope
    const rows = await db
      .select({ app: apps })
      .from(apps)
      .innerJoin(oauthClient, eq(apps.oauthClientId, oauthClient.clientId))
      .where(and(eq(apps.status, 'active'), eq(oauthClient.disabled, false)))
    return rows
      .map(({ app }) => app)
      .filter((app) => appMatches(app, event.type, requiredScope))
      .map((app) => ({
        type: 'app_webhook',
        target: { url: app.webhookEndpoint! },
        config: { appId: app.id },
        deliveryKey: app.id,
      }))
  },
}

/**
 * Resolver registration barrel (EVENTING-V2 WO-8). Importing this module wires
 * every sink resolver into the registry, so the relay imports it for its side
 * effect before draining. Resolvers are added here as the WO-8x extractions land
 * (WO-8a webhook, then 8b integration, 8c notification, 8d ai/summary/pipeline,
 * 8e workflow).
 */
import { registerResolver } from './registry'
import { webhookResolver } from './webhook.resolver'
import { integrationResolver } from './integration.resolver'
import { aiResolver, summaryResolver } from './ai.resolver'

let registered = false

/** Idempotent: registers all resolvers exactly once. */
export function registerAllResolvers(): void {
  if (registered) return
  registered = true
  registerResolver(webhookResolver)
  registerResolver(integrationResolver)
  registerResolver(aiResolver)
  registerResolver(summaryResolver)
}

export * from './registry'

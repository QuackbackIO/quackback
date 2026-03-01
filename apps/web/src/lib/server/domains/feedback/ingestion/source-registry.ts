/**
 * Feedback source registry.
 *
 * Encapsulates the lookup chain: feedback_sources -> integrationId ->
 * integrationType -> connector from integration registry.
 */

import { db, eq, feedbackSources, integrations } from '@/lib/server/db'
import { getIntegration } from '@/lib/server/integrations'
import type { FeedbackSourceId } from '@quackback/ids'
import type { FeedbackConnector } from '@/lib/server/integrations/feedback-source-types'

interface SourceWithConnector {
  source: {
    id: string
    sourceType: string
    deliveryMode: string
    name: string
    config: Record<string, unknown>
    secrets: string | null
    cursor: string | null
    integrationId: string | null
  }
  connector: FeedbackConnector | null
}

/**
 * Resolve a feedback source to its connector implementation.
 * Returns both the source record and the matched connector (if any).
 */
export async function getConnectorForSource(
  sourceId: FeedbackSourceId
): Promise<SourceWithConnector | null> {
  const source = await db.query.feedbackSources.findFirst({
    where: eq(feedbackSources.id, sourceId),
  })

  if (!source) return null

  // Non-integration sources (quackback, csv, api) have no connector via IntegrationDefinition
  if (!source.integrationId) {
    return { source: source as any, connector: null }
  }

  // Resolve integration type
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, source.integrationId),
    columns: { integrationType: true },
  })

  if (!integration) {
    return { source: source as any, connector: null }
  }

  // Get connector from integration registry
  const definition = getIntegration(integration.integrationType)
  return {
    source: source as any,
    connector: definition?.feedbackSource ?? null,
  }
}

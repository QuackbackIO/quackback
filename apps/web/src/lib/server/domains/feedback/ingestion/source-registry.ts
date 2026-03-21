/**
 * Feedback source registry.
 *
 * Encapsulates the lookup chain: feedback_sources -> integrationId ->
 * integrationType -> connector from integration registry.
 */

import type { InferSelectModel } from 'drizzle-orm'
import { db, eq, feedbackSources, integrations } from '@/lib/server/db'
import { getIntegration } from '@/lib/server/integrations'
import type { FeedbackSourceId } from '@quackback/ids'
import type { FeedbackConnector } from '@/lib/server/integrations/feedback-source-types'

type FeedbackSource = InferSelectModel<typeof feedbackSources>

interface SourceWithConnector {
  source: FeedbackSource
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
    return { source, connector: null }
  }

  // Resolve integration type
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, source.integrationId),
    columns: { integrationType: true },
  })

  if (!integration) {
    return { source, connector: null }
  }

  // Get connector from integration registry
  const definition = getIntegration(integration.integrationType)
  return {
    source,
    connector: definition?.feedbackSource ?? null,
  }
}

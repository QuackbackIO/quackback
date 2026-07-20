/**
 * Jira OAuth token access: tokens expire ~hourly, so every API caller must
 * go through here rather than reading the stored accessToken raw. Delegates
 * to the framework's unified refresh helper, which owns expiry checking,
 * BY-ID persistence (the old inline version persisted by integrationType,
 * clobbering sibling Jira integrations), and resolver-cache invalidation.
 */
import type { IntegrationId } from '@quackback/ids'
import { getValidAccessToken } from '@/lib/server/integrations/token-refresh'

/** Return a valid Jira access token for this integration, refreshing if needed. */
export async function getJiraAccessToken(integration: {
  id: IntegrationId
  secrets: unknown
  config: unknown
}): Promise<string> {
  return getValidAccessToken(integration.id)
}

/**
 * Workspace-level gate for the widget ticketing surface. Returns a 404 envelope
 * Response when `widgetConfig.ticketing.enabled !== true`, otherwise null.
 *
 * 404 (not 403) so disabled workspaces look like "this surface doesn't exist
 * here" — symmetric with the iframe simply not rendering the entry card.
 */
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { widgetJsonError } from './cors'

export async function widgetTicketingGate(): Promise<Response | null> {
  const config = await getWidgetConfig()
  if (config.ticketing?.enabled === true) return null
  return widgetJsonError('NOT_FOUND', 'Ticketing is not enabled for this workspace', 404)
}

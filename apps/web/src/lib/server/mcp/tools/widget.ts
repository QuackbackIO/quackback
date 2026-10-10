/**
 * Team-only widget install status. Read-only evidence that the snippet is
 * connected — not first-connect, not the HMAC signing secret.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpAuthContext } from '../types'
import { registerTool, jsonResult, READ_ONLY } from './helpers'

export function registerWidgetTools(server: McpServer, auth: McpAuthContext) {
  registerTool<Record<string, never>>(server, auth, {
    name: 'widget_install_status',
    description: `Read whether the Quackback widget is connected on the customer site.

Returns connected (snippet seen), enabled (Show on your website), last detected time, origin host, and SDK version. Does not return the signing secret. Use after install to prove the launcher loaded — same idea as verifying identity via search, not by fetching credentials.

Examples:
- widget_install_status()`,
    schema: {},
    annotations: READ_ONLY,
    scope: 'read:feedback',
    teamOnly: true,
    handler: async () => {
      const { getWidgetInstallStatus } =
        await import('@/lib/server/domains/settings/widget-install-pairing')
      return jsonResult(await getWidgetInstallStatus())
    },
  })
}

import { createFileRoute } from '@tanstack/react-router'
import { publicWorkspaceCacheHeaders } from '@/lib/server/workspaces/http-cache'

function jsonResponse(body: unknown, maxAge: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // Same path for every workspace, different body for each — see http-cache.ts.
      ...publicWorkspaceCacheHeaders(maxAge),
    },
  })
}

export const Route = createFileRoute('/api/widget/config.json')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getPublicServerConfig } = await import('@/lib/server/widget/public-config')
        const { observeExternalWidgetRequest } =
          await import('@/lib/server/domains/settings/settings.widget')

        const [{ enabled, config }] = await Promise.all([
          getPublicServerConfig(),
          // Best-effort telemetry must never make the public config unavailable.
          observeExternalWidgetRequest(request).catch(() => false),
        ])

        if (!enabled) {
          return jsonResponse({ enabled: false }, 60)
        }
        return jsonResponse(config, 3600)
      },
    },
  },
})

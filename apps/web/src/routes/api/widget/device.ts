import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const deviceSchema = z.object({
  /** Untrusted opaque token from host-page storage; length-capped. */
  deviceId: z.string().min(1).max(128),
})

/**
 * Links the caller's durable device id to their widget session's principal
 * (visitor analytics layer 2). Called by the widget iframe (same-origin)
 * with the session Bearer once a device id and a session both exist; covers
 * the identified and anonymous-mint paths alike. Fire-and-forget: invalid
 * input is dropped with 204, only a missing session is signaled.
 */
export const Route = createFileRoute('/api/widget/device')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { getFeatureFlags } = await import('@/lib/server/domains/settings/settings.service')
          // Device ids ride visitor analytics: the sub-toggle has no effect
          // while the parent flag is off (same AND as the widget config).
          const flags = await getFeatureFlags()
          if (!flags.visitorAnalytics || !flags.visitorDeviceTracking) {
            return new Response(null, { status: 204 })
          }

          const { getWidgetSession } = await import('@/lib/server/functions/widget-auth')
          const auth = await getWidgetSession()
          if (!auth) return new Response(null, { status: 401 })

          const parsed = deviceSchema.safeParse(await request.json())
          if (!parsed.success) return new Response(null, { status: 204 })

          const { linkDeviceToPrincipal } =
            await import('@/lib/server/domains/analytics/device-link.service')
          await linkDeviceToPrincipal(parsed.data.deviceId, auth.principal.id)
          return new Response(null, { status: 204 })
        } catch {
          return new Response(null, { status: 204 })
        }
      },
    },
  },
})

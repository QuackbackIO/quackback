import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { getSession } from '@/lib/server/auth/session'
import { logger } from '@/lib/server/logger'
import { setOrgPortalTabConfig } from '@/lib/server/domains/portal/index.server'
import { z } from 'zod'

const log = logger.child({ component: 'api-portal-tabs' })

const tabConfigSchema = z.object({
  feedback: z.boolean().optional(),
  roadmap: z.boolean().optional(),
  changelog: z.boolean().optional(),
  myTickets: z.boolean().optional(),
  helpCenter: z.boolean().optional(),
  support: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/internal/portal-tabs')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const session = await getSession()
          if (!session?.user?.id) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const { getEffectiveTabConfigForUser } =
            await import('@/lib/server/domains/portal/index.server')
          const config = await getEffectiveTabConfigForUser(session.user.id as UserId)

          return Response.json({ config })
        } catch (error) {
          log.error({ error }, 'Failed to fetch portal tab config')
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },

      POST: async ({ request }) => {
        try {
          const session = await getSession()
          if (!session?.user?.id) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          // Check admin role
          const { principal } = await import('@/lib/server/db')
          const { eq } = await import('@/lib/server/db')
          const { db } = await import('@/lib/server/db')

          const principalRow = await db.query.principal.findFirst({
            where: eq(principal.userId, session.user.id as UserId),
            columns: { role: true },
          })

          if (principalRow?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 })
          }

          const body = await request.json()
          const parsed = tabConfigSchema.parse((body as { config?: unknown })?.config ?? {})

          await setOrgPortalTabConfig(parsed)

          return Response.json({ config: parsed }, { status: 200 })
        } catch (error) {
          if (error instanceof ValidationError || error instanceof z.ZodError) {
            log.warn({ error }, 'Invalid portal tab config')
            return Response.json({ error: 'Invalid configuration' }, { status: 400 })
          }
          log.error({ error }, 'Failed to update portal tab config')
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})

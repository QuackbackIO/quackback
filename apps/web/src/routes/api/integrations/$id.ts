import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '@/lib/server-functions/auth'
import { db, member, integrations, integrationEventMappings, eq } from '@/lib/db'
import { z } from 'zod'
import { isValidTypeId, type IntegrationId } from '@quackback/ids'

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  config: z
    .object({
      channelId: z.string().optional(),
    })
    .optional(),
  eventMappings: z
    .array(
      z.object({
        eventType: z.string(),
        enabled: z.boolean(),
      })
    )
    .optional(),
})

export const Route = createFileRoute('/api/integrations/$id')({
  server: {
    handlers: {
      /**
       * PATCH /api/integrations/[id]
       * Update integration config and event mappings
       */
      PATCH: async ({ request, params }) => {
        const integrationIdParam = params.id

        // Validate TypeID format
        if (!isValidTypeId(integrationIdParam, 'integration')) {
          return Response.json({ error: 'Invalid integration ID format' }, { status: 400 })
        }
        const integrationId = integrationIdParam as IntegrationId

        // Parse and validate body
        let body: z.infer<typeof updateSchema>
        try {
          const json = await request.json()
          body = updateSchema.parse(json)
        } catch {
          return Response.json({ error: 'Invalid request body' }, { status: 400 })
        }

        const { enabled, config, eventMappings } = body

        // Validate session
        const session = await getSession()
        if (!session?.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check user has admin/owner role
        const memberRecord = await db.query.member.findFirst({
          where: eq(member.userId, session.user.id),
        })

        if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
          return Response.json({ error: 'Forbidden - admin role required' }, { status: 403 })
        }

        // Get the integration
        const integration = await db.query.integrations.findFirst({
          where: eq(integrations.id, integrationId),
        })

        if (!integration) {
          return Response.json({ error: 'Integration not found' }, { status: 404 })
        }

        // Update integration
        const updates: Partial<typeof integrations.$inferInsert> = {
          updatedAt: new Date(),
        }

        if (enabled !== undefined) {
          updates.status = enabled ? 'active' : 'paused'
        }

        if (config) {
          // Merge with existing config
          const existingConfig = (integration.config as Record<string, unknown>) || {}
          updates.config = { ...existingConfig, ...config }
        }

        await db.update(integrations).set(updates).where(eq(integrations.id, integrationId))

        // Update event mappings if provided
        if (eventMappings && eventMappings.length > 0) {
          for (const mapping of eventMappings) {
            await db
              .insert(integrationEventMappings)
              .values({
                integrationId,
                eventType: mapping.eventType,
                actionType: 'send_message',
                enabled: mapping.enabled,
              })
              .onConflictDoUpdate({
                target: [
                  integrationEventMappings.integrationId,
                  integrationEventMappings.eventType,
                  integrationEventMappings.actionType,
                ],
                set: {
                  enabled: mapping.enabled,
                  updatedAt: new Date(),
                },
              })
          }
        }

        return Response.json({ success: true })
      },

      /**
       * DELETE /api/integrations/[id]
       * Remove integration record
       */
      DELETE: async ({ params }) => {
        const integrationIdParam = params.id

        // Validate TypeID format
        if (!isValidTypeId(integrationIdParam, 'integration')) {
          return Response.json({ error: 'Invalid integration ID format' }, { status: 400 })
        }
        const integrationId = integrationIdParam as IntegrationId

        // Validate session
        const session = await getSession()
        if (!session?.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check user has admin/owner role
        const memberRecord = await db.query.member.findFirst({
          where: eq(member.userId, session.user.id),
        })

        if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
          return Response.json({ error: 'Forbidden - admin role required' }, { status: 403 })
        }

        // Delete integration
        const result = await db
          .delete(integrations)
          .where(eq(integrations.id, integrationId))
          .returning({ id: integrations.id })

        if (result.length === 0) {
          return Response.json({ error: 'Integration not found' }, { status: 404 })
        }

        return Response.json({ success: true })
      },
    },
  },
})

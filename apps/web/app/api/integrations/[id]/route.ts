/**
 * Integration Update/Delete Route
 *
 * PATCH: Update integration config (enabled, channel_id) and event mappings
 * DELETE: Remove integration record
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { db, member, integrations, integrationEventMappings, eq, and } from '@/lib/db'
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: integrationIdParam } = await params
  // Validate TypeID format - Drizzle column handles UUID conversion
  if (!isValidTypeId(integrationIdParam, 'integration')) {
    return NextResponse.json({ error: 'Invalid integration ID format' }, { status: 400 })
  }
  const integrationId = integrationIdParam as IntegrationId

  // Parse and validate body
  let body: z.infer<typeof updateSchema>
  try {
    const json = await request.json()
    body = updateSchema.parse(json)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { enabled, config, eventMappings } = body

  // Validate session
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user has admin/owner role
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id),
  })

  if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
    return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 })
  }

  // Get the integration
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
  })

  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
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

  await db
    .update(integrations)
    .set(updates)
    .where(eq(integrations.id, integrationId))

  // Update event mappings if provided
  if (eventMappings && eventMappings.length > 0) {
    for (const mapping of eventMappings) {
      // Upsert event mapping
      await db
        .insert(integrationEventMappings)
        .values({
          integrationId,
          eventType: mapping.eventType,
          actionType: 'send_message', // Default action for now
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

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: integrationIdParam } = await params
  // Validate TypeID format - Drizzle column handles UUID conversion
  if (!isValidTypeId(integrationIdParam, 'integration')) {
    return NextResponse.json({ error: 'Invalid integration ID format' }, { status: 400 })
  }
  const integrationId = integrationIdParam as IntegrationId

  // Validate session
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user has admin/owner role
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id),
  })

  if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
    return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 })
  }

  // Delete integration
  const result = await db
    .delete(integrations)
    .where(eq(integrations.id, integrationId))
    .returning({ id: integrations.id })

  if (result.length === 0) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}

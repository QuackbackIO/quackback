/**
 * Integration Update/Delete Route
 *
 * PATCH: Update integration config (enabled, channel_id) and event mappings
 * DELETE: Remove integration record
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import {
  db,
  member,
  organizationIntegrations,
  integrationEventMappings,
  eq,
  and,
} from '@quackback/db'
import { z } from 'zod'

const updateSchema = z.object({
  orgId: z.string(),
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
  const { id: integrationId } = await params

  // Parse and validate body
  let body: z.infer<typeof updateSchema>
  try {
    const json = await request.json()
    body = updateSchema.parse(json)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { orgId, enabled, config, eventMappings } = body

  // Validate session
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user has admin/owner role in org
  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)),
  })

  if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
    return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 })
  }

  // Get the integration
  const integration = await db.query.organizationIntegrations.findFirst({
    where: and(
      eq(organizationIntegrations.id, integrationId),
      eq(organizationIntegrations.organizationId, orgId)
    ),
  })

  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  // Update integration
  const updates: Partial<typeof organizationIntegrations.$inferInsert> = {
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
    .update(organizationIntegrations)
    .set(updates)
    .where(eq(organizationIntegrations.id, integrationId))

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
  const { id: integrationId } = await params
  const { searchParams } = new URL(request.url)
  const orgId = searchParams.get('orgId')

  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  // Validate session
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user has admin/owner role in org
  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)),
  })

  if (!memberRecord || !['owner', 'admin'].includes(memberRecord.role)) {
    return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 })
  }

  // Verify integration belongs to org and delete
  const result = await db
    .delete(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.id, integrationId),
        eq(organizationIntegrations.organizationId, orgId)
      )
    )
    .returning({ id: organizationIntegrations.id })

  if (result.length === 0) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}

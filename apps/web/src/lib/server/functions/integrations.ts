import { createServerFn } from '@tanstack/react-start'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { signOAuthState } from '@/lib/server/auth/oauth-state'
import { db, integrations, integrationEventMappings, eq, sql } from '@/lib/server/db'
import { listSlackChannels } from '@/lib/server/events/integrations/slack/oauth'
import { decryptIntegrationToken } from '@/lib/server/domains/integrations/encryption'
import { config } from '@/lib/server/config'
import type { MemberId, IntegrationId } from '@quackback/ids'

/**
 * Slack OAuth state payload.
 */
export interface SlackOAuthState {
  type: 'slack_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

/**
 * Generate a signed OAuth connect URL for Slack.
 * Self-hosted: relative URL to same origin
 */
export const getSlackConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const auth = await requireAuth({ roles: ['admin'] })

    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'slack_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies SlackOAuthState)

    return `/oauth/slack/connect?state=${encodeURIComponent(state)}`
  }
)

// ============================================
// Schemas
// ============================================

const updateIntegrationSchema = z.object({
  id: z.string(),
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

const deleteIntegrationSchema = z.object({
  id: z.string(),
})

export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>
export type DeleteIntegrationInput = z.infer<typeof deleteIntegrationSchema>

// ============================================
// Mutations
// ============================================

/**
 * Update integration config and event mappings
 */
export const updateIntegrationFn = createServerFn({ method: 'POST' })
  .inputValidator(updateIntegrationSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] updateIntegrationFn: id=${data.id}`)
    await requireAuth({ roles: ['admin'] })

    const integrationId = data.id as IntegrationId

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
    })

    if (!integration) {
      throw new Error('Integration not found')
    }

    const updates: Partial<typeof integrations.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (data.enabled !== undefined) {
      updates.status = data.enabled ? 'active' : 'paused'
    }

    if (data.config) {
      const existingConfig = (integration.config as Record<string, unknown>) || {}
      updates.config = { ...existingConfig, ...data.config }
    }

    await db.update(integrations).set(updates).where(eq(integrations.id, integrationId))

    // Batch upsert all event mappings in a single query
    if (data.eventMappings && data.eventMappings.length > 0) {
      await db
        .insert(integrationEventMappings)
        .values(
          data.eventMappings.map((mapping) => ({
            integrationId,
            eventType: mapping.eventType,
            actionType: 'send_message' as const,
            enabled: mapping.enabled,
          }))
        )
        .onConflictDoUpdate({
          target: [
            integrationEventMappings.integrationId,
            integrationEventMappings.eventType,
            integrationEventMappings.actionType,
          ],
          set: {
            enabled: sql`excluded.enabled`,
            updatedAt: new Date(),
          },
        })
    }

    console.log(`[fn:integrations] updateIntegrationFn: updated id=${data.id}`)
    return { success: true }
  })

/**
 * Delete an integration
 */
export const deleteIntegrationFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteIntegrationSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:integrations] deleteIntegrationFn: id=${data.id}`)
    await requireAuth({ roles: ['admin'] })

    const integrationId = data.id as IntegrationId

    const result = await db
      .delete(integrations)
      .where(eq(integrations.id, integrationId))
      .returning()

    if (result.length === 0) {
      throw new Error('Integration not found')
    }

    console.log(`[fn:integrations] deleteIntegrationFn: deleted id=${data.id}`)
    return { id: data.id }
  })

// ============================================
// Queries
// ============================================

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

/**
 * Fetch available Slack channels for the connected workspace
 */
export const fetchSlackChannelsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SlackChannel[]> => {
    console.log(`[fn:integrations] fetchSlackChannelsFn`)
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'slack'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Slack not connected')
    }

    if (!integration.accessTokenEncrypted) {
      throw new Error('Slack token missing')
    }

    const accessToken = decryptIntegrationToken(integration.accessTokenEncrypted)
    const channels = await listSlackChannels(accessToken)

    console.log(`[fn:integrations] fetchSlackChannelsFn: ${channels.length} channels`)
    return channels
  }
)

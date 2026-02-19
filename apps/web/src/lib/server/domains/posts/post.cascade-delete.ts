/**
 * Cascade delete service for post external links.
 *
 * Orchestrates archiving/closing linked external issues when a post is deleted.
 * Failures are warnings, never blockers -- the post delete always succeeds.
 */

import type { PostId, LinkedEntityId } from '@quackback/ids'
import { db, eq, and, inArray, postExternalLinks, integrations } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { archiveExternalIssue } from '@/lib/server/integrations/archive'

// ============================================================================
// Types
// ============================================================================

export interface PostExternalLink {
  id: string
  integrationType: string
  externalId: string
  externalUrl: string | null
  integrationActive: boolean
  onDeleteDefault: 'archive' | 'nothing'
}

export interface CascadeChoice {
  linkId: string
  integrationType: string
  externalId: string
  externalUrl?: string | null
  shouldArchive: boolean
}

export interface CascadeResult {
  linkId: string
  integrationType: string
  externalId: string
  success: boolean
  error?: string
}

// ============================================================================
// Query
// ============================================================================

/**
 * Get active external links for a post, joined with integration metadata.
 */
export async function getPostExternalLinks(postId: PostId): Promise<PostExternalLink[]> {
  const links = await db
    .select({
      id: postExternalLinks.id,
      integrationType: postExternalLinks.integrationType,
      externalId: postExternalLinks.externalId,
      externalUrl: postExternalLinks.externalUrl,
      integrationStatus: integrations.status,
      integrationConfig: integrations.config,
    })
    .from(postExternalLinks)
    .innerJoin(integrations, eq(postExternalLinks.integrationId, integrations.id))
    .where(and(eq(postExternalLinks.postId, postId), eq(postExternalLinks.status, 'active')))

  return links.map((link) => {
    const config = (link.integrationConfig ?? {}) as Record<string, unknown>
    return {
      id: link.id,
      integrationType: link.integrationType,
      externalId: link.externalId,
      externalUrl: link.externalUrl,
      integrationActive: link.integrationStatus === 'active',
      onDeleteDefault: (config.onDeleteAction as string) === 'archive' ? 'archive' : 'nothing',
    }
  })
}

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute cascade archive/close for selected external links.
 * Runs all archive calls in parallel. Updates link statuses in the database.
 */
export async function executeCascadeDelete(choices: CascadeChoice[]): Promise<CascadeResult[]> {
  const toArchive = choices.filter((c) => c.shouldArchive)
  if (toArchive.length === 0) return []

  // Fetch integration secrets for each link
  const linkIds = toArchive.map((c) => c.linkId as LinkedEntityId)
  const linkRows = await db
    .select({
      id: postExternalLinks.id,
      integrationId: postExternalLinks.integrationId,
      integrationType: postExternalLinks.integrationType,
    })
    .from(postExternalLinks)
    .where(inArray(postExternalLinks.id, linkIds))

  // Build a map of linkId -> integration data
  const integrationIds = [...new Set(linkRows.map((r) => r.integrationId))]
  const integrationRows = await db
    .select({
      id: integrations.id,
      secrets: integrations.secrets,
      config: integrations.config,
    })
    .from(integrations)
    .where(inArray(integrations.id, integrationIds))

  const integrationMap = new Map(integrationRows.map((i) => [i.id, i]))
  const linkIntegrationMap = new Map(linkRows.map((l) => [l.id, l.integrationId]))

  // Run all archive calls in parallel
  const results = await Promise.allSettled(
    toArchive.map(async (choice): Promise<CascadeResult> => {
      const integrationId = linkIntegrationMap.get(choice.linkId as LinkedEntityId)
      const integration = integrationId ? integrationMap.get(integrationId) : undefined

      if (!integration?.secrets) {
        return {
          linkId: choice.linkId,
          integrationType: choice.integrationType,
          externalId: choice.externalId,
          success: false,
          error: 'Integration secrets not available',
        }
      }

      const secrets = decryptSecrets<Record<string, string>>(integration.secrets)
      const config = (integration.config ?? {}) as Record<string, unknown>

      const result = await archiveExternalIssue(choice.integrationType, {
        externalId: choice.externalId,
        externalUrl: choice.externalUrl,
        accessToken: secrets.accessToken || secrets.access_token || '',
        integrationConfig: config,
      })

      // Update link status in the database
      const newStatus = result.success ? (result.action ?? 'archived') : 'error'
      await db
        .update(postExternalLinks)
        .set({ status: newStatus })
        .where(eq(postExternalLinks.id, choice.linkId as LinkedEntityId))

      return {
        linkId: choice.linkId,
        integrationType: choice.integrationType,
        externalId: choice.externalId,
        success: result.success,
        error: result.error,
      }
    })
  )

  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          linkId: '',
          integrationType: '',
          externalId: '',
          success: false,
          error: r.reason instanceof Error ? r.reason.message : 'Unknown error',
        }
  )
}

/**
 * Cascade delete service for post external links.
 *
 * Orchestrates archiving/closing linked external issues when a post is deleted.
 * Failures are warnings, never blockers -- the post delete always succeeds.
 */

import type { PostId, LinkedEntityId, IntegrationId } from '@quackback/ids'
import { db, eq, and, inArray, postExternalLinks, integrations } from '@/lib/server/db'
import { decryptSecrets, encryptSecrets } from '@/lib/server/integrations/encryption'
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

/** Client sends only linkId + shouldArchive. All other fields come from the DB. */
export interface CascadeChoice {
  linkId: string
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
// Token refresh
// ============================================================================

/** Platform-specific token refresh functions, keyed by integration type. */
type RefreshFn = (
  refreshToken: string,
  credentials?: Record<string, string>
) => Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>

const REFRESH_IMPORTS: Record<string, () => Promise<RefreshFn>> = {
  linear: async () => (await import('@/lib/server/integrations/linear/oauth')).refreshLinearToken,
  jira: async () => (await import('@/lib/server/integrations/jira/oauth')).refreshJiraToken,
  asana: async () => (await import('@/lib/server/integrations/asana/oauth')).refreshAsanaToken,
  teams: async () => (await import('@/lib/server/integrations/teams/oauth')).refreshTeamsToken,
}

/**
 * Get a valid access token for an integration, refreshing if needed.
 * Returns the current token if no refresh is needed or no refresh is available.
 */
async function getValidAccessToken(
  integrationId: IntegrationId,
  integrationType: string,
  secrets: Record<string, string>,
  config: Record<string, unknown>
): Promise<string> {
  const token = secrets.accessToken || secrets.access_token || ''
  const refreshToken = secrets.refreshToken || secrets.refresh_token
  const tokenExpiresAt = config.tokenExpiresAt as string | undefined

  // No refresh support for this platform or no refresh token stored
  const refreshImport = REFRESH_IMPORTS[integrationType]
  if (!refreshImport || !refreshToken || !tokenExpiresAt) {
    return token
  }

  // Check if token is expired or about to expire (5 minute buffer)
  const expiresAt = new Date(tokenExpiresAt).getTime()
  const bufferMs = 5 * 60 * 1000
  if (Date.now() < expiresAt - bufferMs) {
    return token // Still valid
  }

  // Refresh the token
  try {
    console.log(`[CascadeDelete] Refreshing ${integrationType} token...`)
    const refreshFn = await refreshImport()
    const { getPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const credentials = await getPlatformCredentials(integrationType)
    const refreshed = await refreshFn(refreshToken, credentials ?? undefined)

    const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
    await db
      .update(integrations)
      .set({
        secrets: encryptSecrets({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? refreshToken,
        }),
        config: { ...config, tokenExpiresAt: newExpiry },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))

    return refreshed.accessToken
  } catch (err) {
    console.error(`[CascadeDelete] Token refresh failed for ${integrationType}:`, err)
    return token // Fall back to existing token; the API call may still 401
  }
}

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute cascade archive/close for selected external links.
 *
 * Only accepts linkId + shouldArchive from the client. All link metadata
 * (integrationType, externalId, externalUrl) is loaded from the database
 * to prevent a caller from targeting arbitrary external issues.
 *
 * The postId is required to scope the link lookup — only links belonging
 * to that post can be archived.
 */
export async function executeCascadeDelete(
  postId: PostId,
  choices: CascadeChoice[]
): Promise<CascadeResult[]> {
  const toArchive = choices.filter((c) => c.shouldArchive)
  if (toArchive.length === 0) return []

  const linkIds = toArchive.map((c) => c.linkId as LinkedEntityId)

  // Fetch link rows scoped to this post — prevents targeting links from other posts
  const linkRows = await db
    .select({
      id: postExternalLinks.id,
      integrationId: postExternalLinks.integrationId,
      integrationType: postExternalLinks.integrationType,
      externalId: postExternalLinks.externalId,
      externalUrl: postExternalLinks.externalUrl,
    })
    .from(postExternalLinks)
    .where(and(inArray(postExternalLinks.id, linkIds), eq(postExternalLinks.postId, postId)))

  const linkMap = new Map(linkRows.map((l) => [l.id, l]))

  // Batch fetch integrations
  const integrationIds = [
    ...new Set(
      linkRows.map((r) => r.integrationId).filter((id): id is NonNullable<typeof id> => id != null)
    ),
  ]
  const integrationRows =
    integrationIds.length > 0
      ? await db
          .select({
            id: integrations.id,
            secrets: integrations.secrets,
            config: integrations.config,
          })
          .from(integrations)
          .where(inArray(integrations.id, integrationIds))
      : []

  const integrationMap = new Map(integrationRows.map((i) => [i.id, i]))

  // Run all archive calls in parallel
  const results = await Promise.allSettled(
    toArchive.map(async (choice): Promise<CascadeResult> => {
      const link = linkMap.get(choice.linkId as LinkedEntityId)
      if (!link) {
        return {
          linkId: choice.linkId,
          integrationType: 'unknown',
          externalId: 'unknown',
          success: false,
          error: 'Link not found for this post',
        }
      }

      const integration = link.integrationId ? integrationMap.get(link.integrationId) : undefined

      if (!integration?.secrets) {
        return {
          linkId: choice.linkId,
          integrationType: link.integrationType,
          externalId: link.externalId,
          success: false,
          error: 'Integration secrets not available',
        }
      }

      const secrets = decryptSecrets<Record<string, string>>(integration.secrets)
      const config = (integration.config ?? {}) as Record<string, unknown>

      const accessToken = await getValidAccessToken(
        integration.id as IntegrationId,
        link.integrationType,
        secrets,
        config
      )

      const result = await archiveExternalIssue(link.integrationType, {
        externalId: link.externalId,
        externalUrl: link.externalUrl,
        accessToken,
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
        integrationType: link.integrationType,
        externalId: link.externalId,
        success: result.success,
        error: result.error,
      }
    })
  )

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          linkId: toArchive[i].linkId,
          integrationType:
            linkMap.get(toArchive[i].linkId as LinkedEntityId)?.integrationType ?? 'unknown',
          externalId: linkMap.get(toArchive[i].linkId as LinkedEntityId)?.externalId ?? 'unknown',
          success: false,
          error: r.reason instanceof Error ? r.reason.message : 'Unknown error',
        }
  )
}

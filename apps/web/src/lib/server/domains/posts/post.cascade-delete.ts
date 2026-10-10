import { getIntegration } from '@/lib/server/integrations'
/**
 * Cascade delete service for post external links.
 *
 * Orchestrates archiving/closing linked external issues when a post is deleted.
 * Failures are warnings, never blockers -- the post delete always succeeds.
 */

import type { PostId, PostExternalLinkId, PrincipalId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  inArray,
  postExternalLinks,
  integrations,
  type Transaction,
} from '@/lib/server/db'
import { queueSyncOperation } from '@/lib/server/integrations/sync/ledger'
import {
  installationIdentity,
  reviewDestination,
  syncOperationKey,
} from '@/lib/server/integrations/sync/identity'

// ============================================================================
// Types
// ============================================================================

export interface PostExternalLink {
  id: string
  integrationType: string
  externalId: string
  externalDisplayId: string | null
  externalUrl: string | null
  integrationActive: boolean
  syncManaged: boolean
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
  action?: 'closed' | 'archived' | 'queued'
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
      externalDisplayId: postExternalLinks.externalDisplayId,
      externalUrl: postExternalLinks.externalUrl,
      integrationStatus: integrations.status,
      integrationConfig: integrations.config,
      syncScope: postExternalLinks.syncScope,
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
      externalDisplayId: link.externalDisplayId,
      externalUrl: link.externalUrl,
      integrationActive: link.integrationStatus === 'active',
      syncManaged: !!link.syncScope,
      onDeleteDefault: (config.onDeleteAction as string) === 'archive' ? 'archive' : 'nothing',
    }
  })
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
  choices: CascadeChoice[],
  options?: { executor: Transaction; requestedBy: PrincipalId }
): Promise<CascadeResult[]> {
  if (!options) throw new Error('Archive requests must share the post deletion transaction')
  const toArchive = choices.filter((c) => c.shouldArchive)
  if (!toArchive.length) return []
  const tx = options.executor
  const rows = await tx
    .select({ link: postExternalLinks, integration: integrations })
    .from(postExternalLinks)
    .innerJoin(integrations, eq(postExternalLinks.integrationId, integrations.id))
    .where(
      and(
        eq(postExternalLinks.postId, postId),
        eq(postExternalLinks.status, 'active'),
        inArray(
          postExternalLinks.id,
          toArchive.map((c) => c.linkId as PostExternalLinkId)
        )
      )
    )
  const results: CascadeResult[] = []
  for (const choice of toArchive) {
    const row = rows.find((r) => r.link.id === choice.linkId)
    if (!row) throw new Error('An archive selection is no longer available')
    const { link, integration } = row
    if (!link.syncScope) continue
    const installation = installationIdentity(integration)
    const destination = reviewDestination(
      link,
      integration,
      getIntegration(integration.integrationType)
    )
    await queueSyncOperation(
      {
        operationKey: syncOperationKey({
          installation,
          destination,
          kind: 'archive',
          sourceType: 'post',
          sourceId: postId,
          remoteId: link.externalId,
        }),
        integrationId: integration.id,
        installation,
        provider: integration.integrationType,
        direction: 'outbound',
        kind: 'archive',
        sourceType: 'post',
        sourceId: postId,
        destination,
        remoteId: link.externalId,
        requestedBy: options.requestedBy,
        state: 'conflict',
        errorCode: 'manual_update',
        result: { externalUrl: link.externalUrl, externalDisplayId: link.externalDisplayId },
        payload: {
          executor: 'archive',
          data: { linkId: link.id, proposedStatus: 'Archive or close this remote item' },
        },
      },
      tx
    )
    results.push({
      linkId: link.id,
      integrationType: link.integrationType,
      externalId: link.externalId,
      success: true,
      action: 'queued',
    })
  }
  return results
}

/**
 * Hook context - centralized resolution of workspace/portal data.
 *
 * This module provides a single point of context resolution for the hook system,
 * eliminating duplicate database queries across hook handlers.
 */

import { db } from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import { getEmailSafeUrl } from '@/lib/server/storage/s3'
import { logger } from '@/lib/server/logger'
import { portalWords, type PortalWords } from '@/lib/shared/design/view'

const log = logger.child({ component: 'hook-context' })

/**
 * Centralized hook context containing workspace data needed by all hooks.
 * Built once per event, passed to all hook target resolvers.
 */
export interface HookContext {
  /** Workspace display name */
  workspaceName: string
  /** Portal base URL for constructing post links */
  portalBaseUrl: string
  /** Brand logo URL (proxied through app), or null if not set */
  logoUrl: string | null
  /** What visitors call what they post, as the portal says it */
  postWord: PortalWords['postWord']
}

/**
 * The portal's word for what visitors post, read as the portal reads it. An
 * email still goes out, saying idea, if the design cannot be read.
 */
async function portalPostWord(): Promise<PortalWords['postWord']> {
  try {
    const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
    return portalWords((await getWorkspaceSettings())?.portalDesign).postWord
  } catch (error) {
    log.warn({ err: error }, 'portal words unavailable; emails say idea')
    return portalWords(undefined).postWord
  }
}

/**
 * Build hook context by querying workspace settings ONCE.
 *
 * @returns HookContext or null if settings not found
 */
export async function buildHookContext(): Promise<HookContext | null> {
  const settings = await db.query.settings.findFirst({
    columns: { name: true, logoKey: true },
  })

  if (!settings) {
    log.error('no workspace settings found')
    return null
  }

  return {
    workspaceName: settings.name,
    portalBaseUrl: getBaseUrl(),
    logoUrl: getEmailSafeUrl(settings.logoKey),
    postWord: await portalPostWord(),
  }
}

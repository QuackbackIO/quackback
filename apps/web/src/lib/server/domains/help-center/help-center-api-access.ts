/**
 * What an API key may see of the help center.
 *
 * Every help center read and vote needs the `read:article` scope. With it, a
 * key reads what is published to everyone. Drafts, private categories and
 * segment-gated content are team material and need `help_center.manage`,
 * including the scope that permission maps to.
 */
import {
  apiKeyHolds,
  assertApiScope,
  withApiKeyAuth,
  type ApiAuthContext,
} from '@/lib/server/domains/api/auth'
import {
  getArticleById,
  getCategoryById,
  getPublicArticleById,
  getPublicCategoryById,
} from '@/lib/server/domains/help-center/help-center.service'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { KbArticleId, KbCategoryId } from '@quackback/ids'

export interface HelpCenterApiAccess {
  auth: ApiAuthContext
  /** True for a key that holds help_center.manage: it sees team material too. */
  manages: boolean
}

/** Authenticate a key for a help center read or vote. */
export async function helpCenterApiAccess(request: Request): Promise<HelpCenterApiAccess> {
  const auth = await withApiKeyAuth(request)
  assertApiScope(auth, 'read:article')
  return { auth, manages: apiKeyHolds(auth, PERMISSIONS.HELP_CENTER_MANAGE) }
}

const closed = (what: string) =>
  new ForbiddenError(
    'FORBIDDEN',
    `Requires the '${PERMISSIONS.HELP_CENTER_MANAGE}' permission to use ${what}`
  )

/**
 * Refuse an article the key may not see: 404 when there is no such article,
 * 403 when it exists but is not published to everyone. A key that manages the
 * help center sees every article, so its caller's own lookup answers 404.
 */
export async function assertArticleOpenToKey(
  access: HelpCenterApiAccess,
  articleId: KbArticleId
): Promise<void> {
  if (access.manages) return
  try {
    await getPublicArticleById(articleId)
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
    await getArticleById(articleId)
    throw closed('an article that is not published to everyone')
  }
}

/**
 * Refuse a category the key may not see: 404 when there is no such category,
 * 403 when it exists but is private or gated.
 */
export async function assertCategoryOpenToKey(
  access: HelpCenterApiAccess,
  categoryId: KbCategoryId
): Promise<void> {
  if (access.manages) return
  try {
    await getPublicCategoryById(categoryId)
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
    await getCategoryById(categoryId)
    throw closed('a category that is not public')
  }
}

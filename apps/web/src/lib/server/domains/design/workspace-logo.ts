/**
 * Publishing the draft with its portal logo as the workspace's logo too, in
 * one transaction: the design and the logo land together, or neither does.
 * The caller checks the person may change the workspace's settings.
 */
import type { PortalDesignRevisionId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { ValidationError } from '@/lib/shared/errors'
import { workspaceLogoOf } from '@/lib/shared/design/workspace-logo'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { saveLogoKey } from '@/lib/server/domains/settings/settings.media'
import {
  designRow,
  publishDraftInTransaction,
  storedDesign,
  type PublishDraftInput,
} from './design.service'

const log = logger.child({ module: 'design-workspace-logo' })

export async function publishDraftWithWorkspaceLogo(
  input: PublishDraftInput
): Promise<{ revisionId: PortalDesignRevisionId; number: number }> {
  const result = await db.transaction(async (tx) => {
    const row = await designRow(tx, true)
    const draft = row?.draft ? storedDesign(row.draft, 'draft') : null
    const key = draft ? workspaceLogoOf(draft) : null
    if (!key)
      throw new ValidationError(
        'NO_PORTAL_LOGO',
        'This draft has no logo the admin and emails can show. Use a PNG, JPEG or WebP logo.'
      )
    const published = await publishDraftInTransaction(tx, input)
    await saveLogoKey(key, { executor: tx })
    return published
  })
  log.info({ revision: result.number }, 'design published with its logo as the workspace logo')
  await invalidateSettingsCache()
  return result
}

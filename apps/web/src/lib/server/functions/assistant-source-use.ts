import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantDocumentId, AssistantWebSourceId } from '@quackback/ids'
import { db, assistantDocuments, assistantWebSources, eq, and, isNull } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { requireAuth } from './auth-helpers'

const sourceUseInput = z.object({
  kind: z.enum(['document', 'webpage']),
  id: z.string().min(1),
  use: z.enum(['customer', 'team']),
  enabled: z.boolean(),
})
/** Update one switch; concurrent edits to the other use cannot overwrite it. */
export const updateAssistantSourceUseFn = createServerFn({ method: 'POST' })
  .validator(sourceUseInput)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const patch =
      data.use === 'customer'
        ? { assistantCustomerUse: data.enabled }
        : { assistantTeamUse: data.enabled }
    const rows =
      data.kind === 'document'
        ? await db
            .update(assistantDocuments)
            .set(patch)
            .where(
              and(
                eq(assistantDocuments.id, data.id as AssistantDocumentId),
                isNull(assistantDocuments.deletedAt)
              )
            )
            .returning({ id: assistantDocuments.id })
        : await db
            .update(assistantWebSources)
            .set(patch)
            .where(eq(assistantWebSources.id, data.id as AssistantWebSourceId))
            .returning({ id: assistantWebSources.id })
    if (!rows.length) throw new NotFoundError('NOT_FOUND', 'Knowledge source not found')
    return { ok: true }
  })

/** Article editors need only the two master switches, never assistant instructions. */
export const getArticleAssistantUseLimitsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const { getAssistantSettings } =
      await import('@/lib/server/domains/settings/settings.assistant')
    const { config } = await getAssistantSettings()
    return {
      customer: config.agents.agent.knowledge.helpCenter,
      team: config.agents.copilot.knowledge.helpCenter,
    }
  }
)

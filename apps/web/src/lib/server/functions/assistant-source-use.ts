import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId, type AssistantDocumentId, type AssistantWebSourceId } from '@quackback/ids'
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

/** An admin preview of stored grounding text; never return object-storage credentials or URLs. */
export const getAssistantKnowledgeSourceFn = createServerFn({ method: 'GET' })
  .validator(z.object({ kind: z.enum(['document', 'webpage']), id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const prefix = data.kind === 'document' ? 'assistant_document' : 'assistant_web_source'
    if (!isValidTypeId(data.id, prefix))
      throw new NotFoundError('NOT_FOUND', 'Knowledge source not found')
    const rows =
      data.kind === 'document'
        ? await db
            .select({
              title: assistantDocuments.title,
              content: assistantDocuments.content,
              updatedAt: assistantDocuments.updatedAt,
              origin: assistantDocuments.fileName,
            })
            .from(assistantDocuments)
            .where(
              and(
                eq(assistantDocuments.id, data.id as AssistantDocumentId),
                isNull(assistantDocuments.deletedAt)
              )
            )
            .limit(1)
        : await db
            .select({
              title: assistantWebSources.title,
              content: assistantWebSources.content,
              updatedAt: assistantWebSources.fetchedAt,
              origin: assistantWebSources.url,
            })
            .from(assistantWebSources)
            .where(eq(assistantWebSources.id, data.id as AssistantWebSourceId))
            .limit(1)
    const row = rows[0]
    if (!row) throw new NotFoundError('NOT_FOUND', 'Knowledge source not found')
    return {
      title: row.title,
      origin: row.origin,
      updatedAt: row.updatedAt.toISOString(),
      text: row.content.slice(0, 20000),
      truncated: row.content.length > 20000,
    }
  })

/**
 * Index health for the rows the Knowledge page is showing.
 *
 * Returned per source id rather than as a list, because the page already has
 * the sources and only needs to know which of them Quinn can currently read.
 * A row with no entry has never been indexed, which the page reads as "queued"
 * rather than as a failure: the backfill has not reached it yet.
 */
export const listAssistantSourceHealthFn = createServerFn({ method: 'GET' })
  .validator(z.object({ kind: z.enum(['document', 'webpage']), ids: z.array(z.string()).max(200) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const prefix = data.kind === 'document' ? 'assistant_document' : 'assistant_web_source'
    const ids = data.ids.filter((id) => isValidTypeId(id, prefix))
    const { listKnowledgeSourceHealth } =
      await import('@/lib/server/domains/assistant/knowledge-index.reads')
    const health = await listKnowledgeSourceHealth(data.kind, ids)
    return ids.map((id) => {
      const row = health.get(id)
      return {
        id,
        status: row?.status ?? ('pending' as const),
        serving: row?.serving ?? false,
        generation: row?.generation ?? null,
        degraded: row?.degradedReason ?? null,
        failure: row?.lastFailureReason ?? null,
      }
    })
  })

/**
 * Ask for a staged refresh of one source's passages.
 *
 * Staged in the ordinary sense the whole projection is: the new generation is
 * built alongside the current one and only replaces it when it is complete, so
 * pressing this can never take a working source out of retrieval.
 */
export const refreshAssistantSourceIndexFn = createServerFn({ method: 'POST' })
  .validator(z.object({ kind: z.enum(['document', 'webpage']), id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const prefix = data.kind === 'document' ? 'assistant_document' : 'assistant_web_source'
    if (!isValidTypeId(data.id, prefix))
      throw new NotFoundError('NOT_FOUND', 'Knowledge source not found')
    const { requestKnowledgeIndexing } =
      await import('@/lib/server/domains/assistant/knowledge-index.service')
    await requestKnowledgeIndexing({ sourceType: data.kind, sourceId: data.id })
    return { ok: true }
  })

/**
 * Canonical guidance authoring for the Guidance page.
 *
 * Gates on `assistant.manage`, like every other assistant write. The list read
 * also refreshes the two config-owned projections, so the page shows the
 * workspace's writing guidelines and its managed workspace instructions beside
 * everything authored here without the assistant config losing ownership of
 * either: those two are edited through the config write funnel, which is where
 * the revision and managed-field checks live.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { GuidanceEntryId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  guidanceEntrySaveSchema,
  GUIDANCE_RUNTIME_BUDGETS,
  type GuidanceEntryDTO,
} from '@/lib/shared/assistant/guidance-entry'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-guidance-entries' })

const deleteGuidanceEntrySchema = z.object({ id: z.string().min(1) })

export interface GuidanceEntriesResult {
  entries: GuidanceEntryDTO[]
  /** The assistant config revision the two config-owned entries were read at. */
  configRevision: number
  budgets: typeof GUIDANCE_RUNTIME_BUDGETS
}

export const listGuidanceEntriesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GuidanceEntriesResult> => {
    log.debug('list guidance entries')
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { getAssistantSettings } =
      await import('@/lib/server/domains/settings/settings.assistant')
    const { projectConfigGuidance, ensureCanonicalGuidance, WRITING_GUIDELINES_PATH } =
      await import('@/lib/server/domains/assistant/guidance-conversion')
    const { listGuidanceEntries, toGuidanceEntryDTO } =
      await import('@/lib/server/domains/assistant/guidance-entries.service')

    const settings = await getAssistantSettings()
    await ensureCanonicalGuidance()
    await projectConfigGuidance(settings.config)

    const entries = await listGuidanceEntries()
    return {
      entries: entries.map((entry) =>
        toGuidanceEntryDTO(
          entry,
          entry.owner === 'config' &&
            (entry.legacySource === 'managed' ||
              isPathManaged(`assistant.${WRITING_GUIDELINES_PATH}`, settings.managedFieldPaths))
        )
      ),
      configRevision: settings.revision,
      budgets: GUIDANCE_RUNTIME_BUDGETS,
    }
  }
)

export const saveGuidanceEntryFn = createServerFn({ method: 'POST' })
  .validator(guidanceEntrySaveSchema)
  .handler(async ({ data }) => {
    log.info({ update: Boolean(data.id) }, 'save guidance entry')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { saveGuidanceEntry, toGuidanceEntryDTO } =
      await import('@/lib/server/domains/assistant/guidance-entries.service')
    const saved = await saveGuidanceEntry({
      id: data.id,
      expectedVersion: data.expectedVersion,
      entry: data.entry,
      createdById: ctx.principal.id,
    })
    await recordAuditEvent({
      event: data.id ? 'assistant.guidance.updated' : 'assistant.guidance.created',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_guidance_entry', id: saved.id },
      after: {
        title: saved.title,
        kind: saved.kind,
        enabled: saved.enabled,
        uses: saved.uses,
        version: saved.version,
      },
    })
    return toGuidanceEntryDTO(saved, false)
  })

export const deleteGuidanceEntryFn = createServerFn({ method: 'POST' })
  .validator(deleteGuidanceEntrySchema)
  .handler(async ({ data }) => {
    log.info('delete guidance entry')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteGuidanceEntry } =
      await import('@/lib/server/domains/assistant/guidance-entries.service')
    await deleteGuidanceEntry(data.id as GuidanceEntryId)
    await recordAuditEvent({
      event: 'assistant.guidance.deleted',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_guidance_entry', id: data.id },
    })
    return { id: data.id }
  })

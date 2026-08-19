/**
 * Abandoned-journey auto-close setting (workflows domain).
 *
 * Storage: like office-hours/tickets/status, this rides in the generic
 * `settings.metadata` JSON bag (no dedicated column, no migration). Reads
 * default at read time (`DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE`, disabled) so
 * a workspace that never touched it still resolves a complete, off-by-default
 * value.
 *
 * This family deliberately uses its own metadata key instead of touching the
 * shared `settings.types.ts` / `settings.service.ts` (mirroring
 * settings.tickets.ts's rationale), so it composes without colliding with
 * concurrent settings work. `getWorkflowAbandonedAutoCloseSettings` is called
 * from the run engine's hot park path (every interactive-block park), same as
 * `getOfficeHoursSchedule` is called from every run's condition-context
 * resolution — a single `requireSettings()` read, uncached, matching that
 * precedent rather than the heavier `getTenantSettings()` consolidation.
 */
import { logger } from '@/lib/server/logger'
import {
  DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE,
  workflowAbandonedAutoCloseSchema,
  type WorkflowAbandonedAutoCloseSettings,
  type UpdateWorkflowAbandonedAutoCloseInput,
} from '@/lib/shared/workflows/abandoned-auto-close'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

export { DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE }
export type { WorkflowAbandonedAutoCloseSettings, UpdateWorkflowAbandonedAutoCloseInput }

const log = logger.child({ component: 'settings-workflows' })

/** Key inside the `settings.metadata` JSON bag. */
const METADATA_KEY = 'workflowAbandonedAutoClose'

/** Resolve the setting from the stored settings row's metadata bag. Pure —
 *  falls back to the (disabled) default on missing/unparseable/invalid
 *  metadata rather than throwing, so a workspace that never saved this
 *  setting (or whose metadata bag is malformed for an unrelated reason)
 *  still reads as "off". */
export function resolveWorkflowAbandonedAutoClose(
  metadataJson: string | null
): WorkflowAbandonedAutoCloseSettings {
  if (!metadataJson) return DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const parsed = workflowAbandonedAutoCloseSchema.safeParse(meta[METADATA_KEY])
    return { ...DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE, ...(parsed.success ? parsed.data : {}) }
  } catch {
    return DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE
  }
}

export async function getWorkflowAbandonedAutoCloseSettings(): Promise<WorkflowAbandonedAutoCloseSettings> {
  try {
    const org = await requireSettings()
    return resolveWorkflowAbandonedAutoClose(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get workflow abandoned auto-close settings failed')
    wrapDbError('fetch workflow abandoned auto-close settings', error)
  }
}

/** Persist a (possibly partial) update; the merged full setting is returned. */
export async function updateWorkflowAbandonedAutoCloseSettings(
  input: UpdateWorkflowAbandonedAutoCloseInput
): Promise<WorkflowAbandonedAutoCloseSettings> {
  log.info(input, 'update workflow abandoned auto-close settings')
  try {
    const validated = workflowAbandonedAutoCloseSchema.parse(input)
    const existing = await getWorkflowAbandonedAutoCloseSettings()
    const merged = { ...existing, ...validated }
    await writeMetadataKey(METADATA_KEY, merged)
    return merged
  } catch (error) {
    log.error({ err: error }, 'update workflow abandoned auto-close settings failed')
    wrapDbError('update workflow abandoned auto-close settings', error)
  }
}

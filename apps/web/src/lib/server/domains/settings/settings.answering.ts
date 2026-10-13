/**
 * Who answers customers on Messenger: the built-in AI, the workspace's own AI
 * agent, or the team. Stored in the settings metadata bag (`supportAnswering`).
 * A workspace that never chose keeps the built-in AI, as before.
 */
import { logger } from '@/lib/server/logger'
import { ANSWER_MODES, type AnswerMode } from '@/lib/shared/support-agents'
import { wrapDbError, writeMetadataKey, requireSettingsCached } from './settings.helpers'

const log = logger.child({ component: 'settings-answering' })

const METADATA_KEY = 'supportAnswering'

export interface AnsweringConfig {
  mode: AnswerMode
}

export const DEFAULT_ANSWERING: AnsweringConfig = { mode: 'quackback_ai' }

export function resolveAnswering(metadataJson: string | null): AnsweringConfig {
  if (!metadataJson) return DEFAULT_ANSWERING
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const raw = meta[METADATA_KEY] as { mode?: unknown } | undefined
    if (raw && (ANSWER_MODES as readonly unknown[]).includes(raw.mode)) {
      return { mode: raw.mode as AnswerMode }
    }
  } catch {
    // Unreadable metadata means nothing was chosen.
  }
  return DEFAULT_ANSWERING
}

export async function getAnswering(): Promise<AnsweringConfig> {
  try {
    const org = await requireSettingsCached()
    return resolveAnswering(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get answering failed')
    wrapDbError('fetch answering', error)
  }
}

export async function updateAnswering(input: AnsweringConfig): Promise<AnsweringConfig> {
  log.info({ mode: input.mode }, 'update answering')
  try {
    const next: AnsweringConfig = { mode: input.mode }
    await writeMetadataKey(METADATA_KEY, next)
    return next
  } catch (error) {
    log.error({ err: error }, 'update answering failed')
    wrapDbError('update answering', error)
  }
}

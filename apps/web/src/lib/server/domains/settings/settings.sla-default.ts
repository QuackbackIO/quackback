/**
 * Default SLA policy (settings family).
 *
 * Storage: rides in the generic `settings.metadata` JSON bag (no dedicated
 * column, no migration), same as the workflows abandoned-auto-close family.
 * Reads default at read time (`DEFAULT_SLA_POLICY_SETTINGS`, no policy) so a
 * workspace that never touched it starts conversations without a stamp.
 */
import { logger } from '@/lib/server/logger'
import {
  DEFAULT_SLA_POLICY_SETTINGS,
  defaultSlaPolicySchema,
  type DefaultSlaPolicySettings,
  type UpdateDefaultSlaPolicyInput,
} from '@/lib/shared/sla/default-policy'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

export { DEFAULT_SLA_POLICY_SETTINGS }
export type { DefaultSlaPolicySettings, UpdateDefaultSlaPolicyInput }

const log = logger.child({ component: 'settings-sla-default' })

/** Key inside the `settings.metadata` JSON bag. */
const METADATA_KEY = 'defaultSlaPolicy'

export function resolveDefaultSlaPolicy(metadataJson: string | null): DefaultSlaPolicySettings {
  if (!metadataJson) return DEFAULT_SLA_POLICY_SETTINGS
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const parsed = defaultSlaPolicySchema.safeParse(meta[METADATA_KEY])
    return parsed.success ? parsed.data : DEFAULT_SLA_POLICY_SETTINGS
  } catch {
    return DEFAULT_SLA_POLICY_SETTINGS
  }
}

export async function getDefaultSlaPolicySettings(): Promise<DefaultSlaPolicySettings> {
  try {
    const org = await requireSettings()
    return resolveDefaultSlaPolicy(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get default SLA policy settings failed')
    wrapDbError('fetch default SLA policy settings', error)
  }
}

export async function updateDefaultSlaPolicySettings(
  input: UpdateDefaultSlaPolicyInput
): Promise<DefaultSlaPolicySettings> {
  log.info(input, 'update default SLA policy settings')
  try {
    const validated = defaultSlaPolicySchema.parse(input)
    await writeMetadataKey(METADATA_KEY, validated)
    return validated
  } catch (error) {
    log.error({ err: error }, 'update default SLA policy settings failed')
    wrapDbError('update default SLA policy settings', error)
  }
}

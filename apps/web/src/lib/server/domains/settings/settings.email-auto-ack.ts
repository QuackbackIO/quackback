/**
 * Cold-inbound auto-acknowledgement. Canonical storage is the settings
 * metadata bag (`emailAutoAck`). Default off.
 */
import { logger } from '@/lib/server/logger'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

const log = logger.child({ component: 'settings-email-auto-ack' })
const METADATA_KEY = 'emailAutoAck'

export type EmailAutoAckConfig = {
  enabled: boolean
}

export const DEFAULT_EMAIL_AUTO_ACK: EmailAutoAckConfig = { enabled: false }

export function resolveEmailAutoAck(metadataJson: string | null): EmailAutoAckConfig {
  if (!metadataJson) return DEFAULT_EMAIL_AUTO_ACK
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const raw = meta[METADATA_KEY]
    if (raw && typeof raw === 'object') {
      return { enabled: (raw as { enabled?: unknown }).enabled === true }
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_EMAIL_AUTO_ACK
}

export async function getEmailAutoAck(): Promise<EmailAutoAckConfig> {
  try {
    const org = await requireSettings()
    return resolveEmailAutoAck(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get email auto-ack failed')
    wrapDbError('fetch email auto-ack', error)
  }
}

export async function updateEmailAutoAck(input: EmailAutoAckConfig): Promise<EmailAutoAckConfig> {
  log.info({ enabled: input.enabled }, 'update email auto-ack')
  try {
    const next: EmailAutoAckConfig = { enabled: input.enabled === true }
    await writeMetadataKey(METADATA_KEY, next)
    return next
  } catch (error) {
    log.error({ err: error }, 'update email auto-ack failed')
    wrapDbError('update email auto-ack', error)
  }
}

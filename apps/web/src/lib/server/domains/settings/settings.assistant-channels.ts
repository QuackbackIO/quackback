/**
 * Which customer channels Quinn may answer on its own (QUINN-PRODUCT P9).
 *
 * The messenger is not here: it is governed by the widget's own
 * `messenger.assistant.respond` switch, which predates this and is what the
 * Deploy page's customer card edits. This record covers the channels that were
 * never autonomous before, and every one of them is off until somebody turns
 * it on. Canonical storage is the settings metadata bag
 * (`assistantChannels`), the same shape the cold-inbound acknowledgement uses.
 *
 * Turning the switch on is necessary and not sufficient. An email reply also
 * has to pass the eligibility rules in `assistant-channel-eligibility.ts`: a
 * sender this workspace could verify, a thread it can reply into, and a
 * conversation nobody else has taken. The switch is the workspace's decision;
 * the rules are what stop that decision reaching a message it should not.
 */
import { logger } from '@/lib/server/logger'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

const log = logger.child({ component: 'settings-assistant-channels' })
const METADATA_KEY = 'assistantChannels'

export interface AssistantChannelsConfig {
  /** Autonomous Quinn replies on the support email channel. */
  email: { enabled: boolean }
}

export const DEFAULT_ASSISTANT_CHANNELS: AssistantChannelsConfig = { email: { enabled: false } }

export function resolveAssistantChannels(metadataJson: string | null): AssistantChannelsConfig {
  if (!metadataJson) return DEFAULT_ASSISTANT_CHANNELS
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const raw = meta[METADATA_KEY]
    if (raw && typeof raw === 'object') {
      const email = (raw as { email?: unknown }).email
      if (email && typeof email === 'object') {
        return { email: { enabled: (email as { enabled?: unknown }).enabled === true } }
      }
    }
  } catch {
    // A metadata bag we cannot read is a workspace with nothing turned on.
  }
  return DEFAULT_ASSISTANT_CHANNELS
}

export async function getAssistantChannels(): Promise<AssistantChannelsConfig> {
  try {
    const org = await requireSettings()
    return resolveAssistantChannels(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get assistant channels failed')
    wrapDbError('fetch assistant channels', error)
  }
}

export async function updateAssistantChannels(
  input: AssistantChannelsConfig
): Promise<AssistantChannelsConfig> {
  log.info({ email_enabled: input.email.enabled }, 'update assistant channels')
  try {
    const next: AssistantChannelsConfig = { email: { enabled: input.email.enabled === true } }
    await writeMetadataKey(METADATA_KEY, next)
    return next
  } catch (error) {
    log.error({ err: error }, 'update assistant channels failed')
    wrapDbError('update assistant channels', error)
  }
}

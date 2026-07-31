/**
 * Workspace spam-filter configuration: the trusted-sender list the inbound
 * spam classifier honors. A trusted sender (exact address or whole domain)
 * bypasses classification entirely — the workspace's explicit "never spam"
 * list, so a known partner's odd-looking mail can never be auto-filed.
 * Stored as JSON on the settings row (`spam_filter_config`); absent means an
 * empty list (nobody is trusted by default).
 */
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { MAX_TRUSTED_SENDERS, normalizeTrustedSenderEntry } from '@/lib/shared/trusted-senders'
import { invalidateSettingsCache, requireSettings } from './settings.helpers'

export { MAX_TRUSTED_SENDERS }

const log = logger.child({ component: 'settings-spam' })

export interface SpamFilterConfig {
  /** Lower-cased entries: a full address (`jane@acme.com`) or a whole domain
   *  (`acme.com` / `@acme.com`). */
  trustedSenders: string[]
}

export const DEFAULT_SPAM_FILTER_CONFIG: SpamFilterConfig = { trustedSenders: [] }

/** Parse the stored JSON, tolerating missing/malformed data as "no trust list". */
export function parseSpamFilterConfig(json: string | null): SpamFilterConfig {
  if (!json) return DEFAULT_SPAM_FILTER_CONFIG
  try {
    const raw = JSON.parse(json) as { trustedSenders?: unknown }
    if (!Array.isArray(raw?.trustedSenders)) return DEFAULT_SPAM_FILTER_CONFIG
    const trustedSenders = [
      ...new Set(
        raw.trustedSenders.map(normalizeTrustedSenderEntry).filter((e): e is string => e !== null)
      ),
    ].slice(0, MAX_TRUSTED_SENDERS)
    return { trustedSenders }
  } catch {
    return DEFAULT_SPAM_FILTER_CONFIG
  }
}

/**
 * Whether an inbound sender is on the workspace trust list. Exact-address
 * entries match that address; domain entries match the sender's domain only
 * (a suffix lookalike like `evilacme.com` and subdomains do NOT match).
 */
export function isTrustedSender(email: string | null, trustedSenders: readonly string[]): boolean {
  const sender = email?.trim().toLowerCase()
  if (!sender || trustedSenders.length === 0) return false
  const at = sender.lastIndexOf('@')
  if (at <= 0 || at === sender.length - 1) return false
  const domain = sender.slice(at + 1)
  return trustedSenders.some((entry) => {
    const e = entry.trim().toLowerCase()
    if (!e) return false
    if (e === sender) return true
    const entryDomain = e.startsWith('@') ? e.slice(1) : e
    return !entryDomain.includes('@') && domain === entryDomain
  })
}

/** Read the workspace spam-filter config (empty trust list when unset). */
export async function getSpamFilterConfig(): Promise<SpamFilterConfig> {
  const org = await requireSettings()
  return parseSpamFilterConfig(org.spamFilterConfig)
}

/** Replace the trusted-sender list. Entries are normalized and de-duplicated;
 *  implausible entries are dropped (same rule as the read path). */
export async function updateSpamFilterConfig(input: {
  trustedSenders: string[]
}): Promise<SpamFilterConfig> {
  const org = await requireSettings()
  const updated: SpamFilterConfig = {
    trustedSenders: [
      ...new Set(
        input.trustedSenders.map(normalizeTrustedSenderEntry).filter((e): e is string => e !== null)
      ),
    ].slice(0, MAX_TRUSTED_SENDERS),
  }
  await db
    .update(settings)
    .set({ spamFilterConfig: JSON.stringify(updated) })
    .where(eq(settings.id, org.id))
  await invalidateSettingsCache()
  log.info({ trusted_count: updated.trustedSenders.length }, 'spam filter config updated')
  return updated
}

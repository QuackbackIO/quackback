/**
 * Workspace spam-filter configuration: the trusted-sender list the inbound
 * spam classifier honors, and whether the AI classifier runs at all. A
 * trusted sender (exact address or whole domain) bypasses classification
 * entirely — the workspace's explicit "never spam" list, so a known
 * partner's odd-looking mail can never be auto-filed. Stored as JSON on the
 * settings row (`spam_filter_config`); an absent list means nobody is
 * trusted, and an absent `aiClassifier` means the classifier is on.
 */
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { MAX_TRUSTED_SENDERS, normalizeTrustedSenderEntry } from '@/lib/shared/trusted-senders'
import { invalidateSettingsCache, requireSettings, requireSettingsCached } from './settings.helpers'

export { MAX_TRUSTED_SENDERS }

const log = logger.child({ component: 'settings-spam' })

export interface SpamFilterConfig {
  /** Lower-cased entries: a full address (`jane@acme.com`) or a whole domain
   *  (`acme.com` / `@acme.com`). */
  trustedSenders: string[]
  /** Whether new inbound conversations are sent to the AI spam classifier.
   *  Deterministic sender signals and the trust list apply either way. */
  aiClassifier: boolean
}

export const DEFAULT_SPAM_FILTER_CONFIG: SpamFilterConfig = {
  trustedSenders: [],
  aiClassifier: true,
}

function normalizeTrustedSenders(entries: unknown[]): string[] {
  return [
    ...new Set(entries.map(normalizeTrustedSenderEntry).filter((e): e is string => e !== null)),
  ].slice(0, MAX_TRUSTED_SENDERS)
}

/** Parse the stored JSON, tolerating missing/malformed fields one by one. */
export function parseSpamFilterConfig(json: string | null): SpamFilterConfig {
  if (!json) return DEFAULT_SPAM_FILTER_CONFIG
  let raw: { trustedSenders?: unknown; aiClassifier?: unknown } | null
  try {
    raw = JSON.parse(json)
  } catch {
    return DEFAULT_SPAM_FILTER_CONFIG
  }
  if (raw === null || typeof raw !== 'object') return DEFAULT_SPAM_FILTER_CONFIG
  return {
    trustedSenders: Array.isArray(raw.trustedSenders)
      ? normalizeTrustedSenders(raw.trustedSenders)
      : [],
    aiClassifier:
      typeof raw.aiClassifier === 'boolean'
        ? raw.aiClassifier
        : DEFAULT_SPAM_FILTER_CONFIG.aiClassifier,
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
  const org = await requireSettingsCached()
  return parseSpamFilterConfig(org.spamFilterConfig)
}

/** Update the trusted-sender list and/or the AI classifier switch; fields
 *  left out keep their stored value. List entries are normalized and
 *  de-duplicated; implausible entries are dropped (same rule as the read path). */
export async function updateSpamFilterConfig(input: {
  trustedSenders?: string[]
  aiClassifier?: boolean
}): Promise<SpamFilterConfig> {
  const org = await requireSettings()
  const current = parseSpamFilterConfig(org.spamFilterConfig)
  const updated: SpamFilterConfig = {
    trustedSenders:
      input.trustedSenders !== undefined
        ? normalizeTrustedSenders(input.trustedSenders)
        : current.trustedSenders,
    aiClassifier: input.aiClassifier ?? current.aiClassifier,
  }
  await db
    .update(settings)
    .set({ spamFilterConfig: JSON.stringify(updated) })
    .where(eq(settings.id, org.id))
  await invalidateSettingsCache()
  log.info(
    { trusted_count: updated.trustedSenders.length, ai_classifier: updated.aiClassifier },
    'spam filter config updated'
  )
  return updated
}

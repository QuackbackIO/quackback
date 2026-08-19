/**
 * Client-safe validation for trusted-sender entries, shared by the inbound
 * spam filter (server) and the admin settings UI (client) so both sides apply
 * the same "what is a plausible entry" rule.
 */

/** Cap on list size — the match runs on every inbound message, and an
 *  unbounded list only ever grows by operator mistake. */
export const MAX_TRUSTED_SENDERS = 500

/** Normalize one entry: trimmed, lower-cased, and plausibly an address or a
 *  domain. Anything else is dropped rather than stored to match nothing. */
export function normalizeTrustedSenderEntry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const entry = raw.trim().toLowerCase()
  if (!entry || entry.length > 320 || /\s/.test(entry)) return null
  const bare = entry.startsWith('@') ? entry.slice(1) : entry
  // A domain entry is dot-separated labels; an address entry adds a local part.
  if (
    !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(bare) &&
    !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare)
  )
    return null
  return entry
}

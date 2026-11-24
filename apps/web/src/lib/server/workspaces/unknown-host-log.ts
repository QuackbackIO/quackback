/**
 * The "no workspace claims this hostname" warning, at most once per host per
 * window.
 *
 * A hostname nobody claims is worth one line: it is how a missing domain
 * record or a deleted workspace that is still linked somewhere shows up. Most
 * of the traffic it sees is vulnerability scanners walking a wordlist
 * (`/.env`, `/phpinfo.php`) at hundreds of requests a second, and a line per
 * request adds nothing to the first one: the access log already records each
 * request and its 404. The next line for a host after its window reports how
 * many were folded into the previous one.
 *
 * The map is keyed by a value the client chooses (the Host header), so it is
 * bounded: past MAX_TRACKED_HOSTS it starts over, which at worst repeats a
 * warning early.
 */
import type { logger } from '@/lib/server/logger'

const WINDOW_MS = 60_000
const MAX_TRACKED_HOSTS = 1_000

const recent = new Map<string, { loggedAt: number; folded: number }>()

export function warnUnknownHost(
  host: string,
  log: Pick<typeof logger, 'warn'>,
  now: number = Date.now()
): void {
  const entry = recent.get(host)
  if (entry && now - entry.loggedAt < WINDOW_MS) {
    entry.folded++
    return
  }
  if (!entry && recent.size >= MAX_TRACKED_HOSTS) recent.clear()
  log.warn(
    { host, ...(entry && entry.folded > 0 && { foldedSinceLast: entry.folded }) },
    'no workspace claims this hostname'
  )
  recent.set(host, { loggedAt: now, folded: 0 })
}

/** Forget every host (tests). */
export function resetUnknownHostLog(): void {
  recent.clear()
}

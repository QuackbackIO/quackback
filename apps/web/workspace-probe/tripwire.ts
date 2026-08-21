/**
 * The tripwire: a global scan of every response the harness receives.
 *
 * Individual probes assert on the specific thing they attacked. The tripwire is
 * the backstop for everything the probe author did not think to check — it
 * inspects the full body of every exchange for any string that can only belong
 * to the other workspace.
 *
 * This matters because the fixture data is deliberately colliding: both workspaces
 * have a user `admin@example.com`, a board titled "Feature Requests" and a post
 * titled "Dark mode". A wrong-workspace answer is therefore indistinguishable from
 * a right-workspace answer on every human-readable field. The marker vocabulary is
 * the only thing that separates them:
 *
 *  - a per-workspace canary string embedded in fixture body text, and
 *  - workspace-unique TypeIDs discovered at preflight (workspace, user, principal,
 *    board, post), which cannot collide by construction.
 *
 * Echo suppression: a probe that deliberately sends a foreign marker (searching
 * bravo for alpha's canary, replaying alpha's cookie to bravo) will see that
 * marker reflected in an error body or a query echo. Suppression is done on the
 * only basis that is actually sound — a marker the harness itself put on the
 * wire is never counted — and the wire means the whole request: the url, the
 * body, the headers (a replayed cookie or Bearer credential travels nowhere
 * else), and any base64url payload embedded in them (an id inside a signed
 * token's claims).
 *
 * What suppression must NOT be is a per-exchange opt-out. `expectsForeignMarkers`
 * used to return the hits to the caller and drop them from the collection, and
 * because EVERY deliberate cross-workspace attempt sets that flag, the tripwire's
 * real coverage was reduced to incidental traffic — it was switched off on
 * precisely the replays it exists to backstop, leaving them covered only by
 * whatever each probe author had thought to check. The flag now labels a hit
 * `deliberate` and changes nothing else.
 */

import type {
  Exchange,
  WorkspaceMarkers,
  WorkspaceSlot,
  TripwireHit,
  TripwireRecorder,
} from './types'

/**
 * Markers shorter than this are ignored. TypeIDs are 26+ characters after the
 * prefix and canaries are longer still, so this only excludes accidental
 * garbage — a short marker would produce chance matches and a suite that cries
 * wolf gets switched off, which is the worst outcome available.
 */
export const MIN_MARKER_LENGTH = 12

const EXCERPT_RADIUS = 120

function excerptAround(haystack: string, needle: string): string {
  const at = haystack.indexOf(needle)
  if (at === -1) return ''
  const start = Math.max(0, at - EXCERPT_RADIUS)
  const end = Math.min(haystack.length, at + needle.length + EXCERPT_RADIUS)
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`
}

interface VocabularyEntry {
  owner: WorkspaceSlot
  name: string
  value: string
  /** The value is itself a credential and must never reach the report. */
  sensitive: boolean
}

function buildVocabulary(markers: WorkspaceMarkers): VocabularyEntry[] {
  const out: VocabularyEntry[] = []
  if (markers.canary.length >= MIN_MARKER_LENGTH) {
    out.push({ owner: markers.slot, name: 'canary', value: markers.canary, sensitive: false })
  }
  for (const [name, value] of Object.entries(markers.ids)) {
    if (typeof value === 'string' && value.length >= MIN_MARKER_LENGTH) {
      out.push({ owner: markers.slot, name, value, sensitive: false })
    }
  }
  // Credentials are scanned exactly like ids — a widget signing secret turning
  // up in a response is among the worst things this suite could find — but the
  // value is withheld from the hit, because a report file gets pasted around.
  for (const [name, value] of Object.entries(markers.sensitive ?? {})) {
    if (typeof value === 'string' && value.length >= MIN_MARKER_LENGTH) {
      out.push({ owner: markers.slot, name, value, sensitive: true })
    }
  }
  return out
}

const REDACTED = '<redacted>'

/**
 * Substrings long enough to be a base64url-encoded payload rather than a word.
 * JWT segments and opaque session values both match; ordinary prose does not.
 */
const ENCODED_SEGMENT = /[A-Za-z0-9_-]{16,}/g

/**
 * Everything the harness put on the wire for this exchange, plus whatever falls
 * out of base64url-decoding the token-shaped parts of it.
 *
 * The decode matters because a marker can travel by a route a literal
 * substring check cannot see: a widget SSO token carries `sub` inside a
 * base64url payload, so the id is genuinely present in the request while
 * appearing nowhere in it verbatim. Without the decode, an error body echoing
 * that id back would be counted as a leak on a perfectly isolated fleet — and
 * the response to that false positive would be to switch the tripwire off
 * again, which is how this defect happened the first time.
 */
function sentHaystack(exchange: Exchange): string {
  const literal = [
    exchange.url,
    exchange.requestBody,
    ...Object.values(exchange.requestHeaders ?? {}),
  ].join('\n')
  const decoded: string[] = []
  for (const segment of literal.match(ENCODED_SEGMENT) ?? []) {
    const text = Buffer.from(segment, 'base64url').toString('utf8')
    if (text) decoded.push(text)
  }
  return `${literal}\n${decoded.join('\n')}`
}

/**
 * Build the recorder. Both workspaces' marker sets are supplied; a response served
 * by one workspace is scanned against the *other* workspace's vocabulary only.
 */
export function createTripwire(alpha: WorkspaceMarkers, bravo: WorkspaceMarkers): TripwireRecorder {
  const vocabulary: Record<WorkspaceSlot, VocabularyEntry[]> = {
    alpha: buildVocabulary(alpha),
    bravo: buildVocabulary(bravo),
  }
  const collected: TripwireHit[] = []

  return {
    setMarkers(nextAlpha: WorkspaceMarkers, nextBravo: WorkspaceMarkers): void {
      vocabulary.alpha = buildVocabulary(nextAlpha)
      vocabulary.bravo = buildVocabulary(nextBravo)
    },

    record(exchange: Exchange): TripwireHit[] {
      const foreignOwner: WorkspaceSlot = exchange.workspace === 'alpha' ? 'bravo' : 'alpha'
      const foreignVocabulary = vocabulary[foreignOwner]
      if (foreignVocabulary.length === 0) return []

      // Anything the harness itself put on the wire cannot count as a leak.
      const sent = sentHaystack(exchange)
      const found: TripwireHit[] = []

      for (const entry of foreignVocabulary) {
        if (!exchange.responseText.includes(entry.value)) continue
        if (sent.includes(entry.value)) continue
        const excerpt = excerptAround(exchange.responseText, entry.value)
        found.push({
          servedBy: exchange.workspace,
          markerOwner: entry.owner,
          markerName: entry.name,
          marker: entry.sensitive ? REDACTED : entry.value,
          method: exchange.method,
          url: exchange.url,
          status: exchange.status,
          excerpt: entry.sensitive ? excerpt.split(entry.value).join(REDACTED) : excerpt,
          redacted: entry.sensitive,
          deliberate: exchange.expectsForeignMarkers,
        })
      }

      // Deliberate and incidental hits are collected identically. A marker the
      // host served but the harness never sent has no innocent explanation,
      // and the exchanges where a probe went looking for one are exactly where
      // it is most likely to be found.
      collected.push(...found)
      return found
    },

    hits(): TripwireHit[] {
      return [...collected]
    },

    hitsSince(index: number): TripwireHit[] {
      return collected.slice(index)
    },

    hitCount(): number {
      return collected.length
    },
  }
}

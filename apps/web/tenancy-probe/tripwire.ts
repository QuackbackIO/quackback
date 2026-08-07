/**
 * The tripwire: a global scan of every response the harness receives.
 *
 * Individual probes assert on the specific thing they attacked. The tripwire is
 * the backstop for everything the probe author did not think to check — it
 * inspects the full body of every exchange for any string that can only belong
 * to the other tenant.
 *
 * This matters because the fixture data is deliberately colliding: both tenants
 * have a user `admin@example.com`, a board titled "Feature Requests" and a post
 * titled "Dark mode". A wrong-tenant answer is therefore indistinguishable from
 * a right-tenant answer on every human-readable field. The marker vocabulary is
 * the only thing that separates them:
 *
 *  - a per-tenant canary string embedded in fixture body text, and
 *  - tenant-unique TypeIDs discovered at preflight (workspace, user, principal,
 *    board, post), which cannot collide by construction.
 *
 * Echo suppression: a probe that deliberately sends a foreign marker (searching
 * bravo for alpha's canary, replaying alpha's cookie to bravo) will see that
 * marker reflected in an error body or a query echo. Those exchanges are marked
 * `expectsForeignMarkers`, and any marker present in the request itself is never
 * counted as a hit.
 */

import type { Exchange, TenantMarkers, TenantSlot, TripwireHit, TripwireRecorder } from './types'

/**
 * Markers shorter than this are ignored. TypeIDs are 26+ characters after the
 * prefix and canaries are longer still, so this only excludes accidental
 * garbage — a short marker would produce chance matches and a suite that cries
 * wolf gets switched off, which is the worst outcome available.
 */
const MIN_MARKER_LENGTH = 12

const EXCERPT_RADIUS = 120

function excerptAround(haystack: string, needle: string): string {
  const at = haystack.indexOf(needle)
  if (at === -1) return ''
  const start = Math.max(0, at - EXCERPT_RADIUS)
  const end = Math.min(haystack.length, at + needle.length + EXCERPT_RADIUS)
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`
}

interface VocabularyEntry {
  owner: TenantSlot
  name: string
  value: string
}

function buildVocabulary(markers: TenantMarkers): VocabularyEntry[] {
  const out: VocabularyEntry[] = []
  if (markers.canary.length >= MIN_MARKER_LENGTH) {
    out.push({ owner: markers.slot, name: 'canary', value: markers.canary })
  }
  for (const [name, value] of Object.entries(markers.ids)) {
    if (typeof value === 'string' && value.length >= MIN_MARKER_LENGTH) {
      out.push({ owner: markers.slot, name, value })
    }
  }
  return out
}

/**
 * Build the recorder. Both tenants' marker sets are supplied; a response served
 * by one tenant is scanned against the *other* tenant's vocabulary only.
 */
export function createTripwire(alpha: TenantMarkers, bravo: TenantMarkers): TripwireRecorder {
  const vocabulary: Record<TenantSlot, VocabularyEntry[]> = {
    alpha: buildVocabulary(alpha),
    bravo: buildVocabulary(bravo),
  }
  const collected: TripwireHit[] = []

  return {
    setMarkers(nextAlpha: TenantMarkers, nextBravo: TenantMarkers): void {
      vocabulary.alpha = buildVocabulary(nextAlpha)
      vocabulary.bravo = buildVocabulary(nextBravo)
    },

    record(exchange: Exchange): TripwireHit[] {
      const foreignOwner: TenantSlot = exchange.tenant === 'alpha' ? 'bravo' : 'alpha'
      const foreignVocabulary = vocabulary[foreignOwner]
      if (foreignVocabulary.length === 0) return []

      // Anything the harness itself put on the wire cannot count as a leak.
      const sent = `${exchange.url}\n${exchange.requestBody}`
      const found: TripwireHit[] = []

      for (const entry of foreignVocabulary) {
        if (!exchange.responseText.includes(entry.value)) continue
        if (sent.includes(entry.value)) continue
        found.push({
          servedBy: exchange.tenant,
          markerOwner: entry.owner,
          markerName: entry.name,
          marker: entry.value,
          method: exchange.method,
          url: exchange.url,
          status: exchange.status,
          excerpt: excerptAround(exchange.responseText, entry.value),
        })
      }

      // `expectsForeignMarkers` covers the case where a marker travels by a
      // route the request-body check cannot see (a replayed session cookie, a
      // signed token whose payload embeds an id). The exchange is still
      // recorded and still scanned, so the probe can inspect `found` itself
      // and decide — it just does not raise a suite-level tripwire hit.
      if (exchange.expectsForeignMarkers) return found

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

/**
 * P08 — bravo reading any row, object or presence signal created by alpha.
 *
 * The catch-all. Where the other probes each attack one credential, this one
 * asks the blunt question from the other side: with no credential at all, can
 * bravo's public surfaces be made to return something that belongs to alpha?
 *
 * The colliding fixture is what gives this teeth. Both tenants have a post
 * titled "Dark mode" on a board called "Feature Requests" with the slug
 * `tenancy-probe`. Searching bravo for "Dark mode" is SUPPOSED to return a
 * result — the assertion is not "no results", it is "every result is bravo's".
 * A suite that asserted emptiness here would fail on a correct system and be
 * turned off; a suite that asserted "a post was returned" would pass on a
 * totally broken one. Only the ids separate them.
 */

import {
  scanForMarker,
  describeHits,
  scanCoverage,
  type ScanHit,
  type ScanResult,
} from '../db-scan'
import { markerSearchForms } from '../db'
import { control, decide, dirFrom, describeResponse, error, markersPresent } from './helpers'
import type { ControlOutcome, Probe, ProbeContext } from '../types'
import { FIXTURE } from '../fixtures'

interface WidgetSearchBody {
  data?: { posts?: Array<{ id: string; title: string; board?: { id: string; slug: string } }> }
}

export const p08CrossRead: Probe = {
  id: 'P08',
  name: 'cross-tenant-row-object-and-presence-read',
  family: 'read',
  proves:
    'No public surface on bravo returns a row, id or canary belonging to alpha — including the ' +
    'search endpoint queried with a title that exists identically in both tenants, and (with database ' +
    'access) any row anywhere in bravo’s schema.',
  requires: ['http'],

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      `search bravo's public endpoints for the colliding post title "${FIXTURE.postTitle}" and for ` +
      `alpha's canary, read bravo's portal documents for the shared board slug, and scan bravo's ` +
      `database for every one of alpha's markers`

    const controls: ControlOutcome[] = []
    const evidence: Record<string, unknown> = {}

    const searchPath = (q: string) => `/api/widget/search?q=${encodeURIComponent(q)}&limit=25`

    // --- positive control: the colliding search works at all ----------------
    const ownSearch = await alpha.http.request(searchPath(FIXTURE.postTitle), { omitCookies: true })
    const ownPosts = ownSearch.json<WidgetSearchBody>()?.data?.posts ?? []
    const ownFound = ownPosts.some((p) => p.id === alpha.fixture?.postId)
    controls.push(
      control(
        'positive',
        `alpha search for "${FIXTURE.postTitle}" returns alpha's fixture post`,
        ownFound,
        ownFound
          ? `found post ${alpha.fixture?.postId} among ${ownPosts.length} result(s)`
          : `alpha's own fixture post was NOT returned (${ownPosts.length} result(s), ${describeResponse(ownSearch, 160)}) — ` +
              `the search surface is blind, so an empty result from bravo would prove nothing`
      )
    )
    if (!ownFound) {
      return error({
        attempted,
        observed: describeResponse(ownSearch, 300),
        reason:
          'the positive control failed: alpha’s public search does not return alpha’s own fixture ' +
          'post. Either the board is not publicly visible or the post has not been indexed. Until ' +
          'that is fixed, a clean result from bravo is not evidence of isolation.',
        controls,
      })
    }

    // --- negative: the colliding title on BOTH hosts -------------------------
    //
    // Both directions, like every other cross-tenant attempt in this suite.
    // This check was once bravo-only: an asymmetric leak — one tenant's index
    // poisoning the other's results but not the reverse — would have sailed
    // through, hidden by the probe's other symmetric checks.
    for (const [fromSlot, from, to] of [
      ['alpha', alpha, bravo],
      ['bravo', bravo, alpha],
    ] as const) {
      const crossSearch = await to.http.request(searchPath(FIXTURE.postTitle), {
        omitCookies: true,
      })
      const crossPosts = crossSearch.json<WidgetSearchBody>()?.data?.posts ?? []
      const foreignIds = new Set(
        [from.fixture?.postId, from.fixture?.boardId].filter(Boolean) as string[]
      )
      const foreignResults = crossPosts.filter(
        (p) => foreignIds.has(p.id) || (p.board?.id && foreignIds.has(p.board.id))
      )
      const foundOwn = crossPosts.some((p) => p.id === to.fixture?.postId)
      controls.push(
        control(
          'negative',
          `${to.slot} search for the colliding title "${FIXTURE.postTitle}" returns only ${to.slot}'s rows`,
          foreignResults.length === 0,
          foreignResults.length === 0
            ? `${crossPosts.length} result(s), all ${to.slot}'s${foundOwn ? ` (including ${to.slot}'s own fixture post)` : ''}`
            : `${fromSlot.toUpperCase()}'S ROWS RETURNED: ${foreignResults.map((p) => p.id).join(', ')}`,
          dirFrom(fromSlot),
          'colliding-title-search'
        )
      )
      evidence[`${to.slot}SearchResultIds`] = crossPosts.map((p) => p.id)
    }

    // --- negative: each tenant's canary searched on the other ---------------
    for (const [fromSlot, from, to] of [
      ['alpha', alpha, bravo],
      ['bravo', bravo, alpha],
    ] as const) {
      const canarySearch = await to.http.request(searchPath(from.markers.canary), {
        omitCookies: true,
        expectsForeignMarkers: true,
      })
      const canaryPosts = canarySearch.json<WidgetSearchBody>()?.data?.posts ?? []
      controls.push(
        control(
          'negative',
          `${to.slot} search for ${fromSlot}'s canary returns nothing`,
          canaryPosts.length === 0,
          canaryPosts.length === 0
            ? 'no results'
            : `RETURNED ${canaryPosts.length} result(s): ${canaryPosts.map((p) => p.id).join(', ')}`,
          dirFrom(fromSlot),
          'canary-search'
        )
      )
    }

    // --- negative: portal documents on the shared board slug, both ways -----
    for (const [fromSlot, from, to] of [
      ['alpha', alpha, bravo],
      ['bravo', bravo, alpha],
    ] as const) {
      for (const path of ['/', `/b/${FIXTURE.boardSlug}`]) {
        const doc = await to.http.request(path, { omitCookies: true })
        const found = markersPresent(doc.text, from.markers)
        controls.push(
          control(
            'negative',
            `${to.slot} GET ${path} contains no ${fromSlot} marker`,
            found.length === 0,
            found.length === 0
              ? `HTTP ${doc.status}, clean`
              : `HTTP ${doc.status}, ${fromSlot.toUpperCase()} MARKERS PRESENT: ${found.join(', ')}`,
            dirFrom(fromSlot),
            `portal-document-markers:${path}`
          )
        )
      }
    }

    // --- negative: each tenant's whole schema, scanned for the other --------
    if (alpha.db && bravo.db) {
      const results: ScanResult[] = []
      for (const [fromSlot, from, to] of [
        ['alpha', alpha, bravo],
        ['bravo', bravo, alpha],
      ] as const) {
        const markers = [
          from.markers.canary,
          ...Object.values(from.markers.ids).flatMap(markerSearchForms),
        ]
        const hits: ScanHit[] = []
        for (const marker of markers) {
          if (marker.length < 8) continue
          const result = await scanForMarker(to.db!, marker)
          hits.push(...result.hits)
          results.push(result)
        }
        controls.push(
          control(
            'negative',
            `${to.slot}'s database contains none of ${fromSlot}'s markers`,
            hits.length === 0,
            hits.length === 0
              ? `scanned ${markers.length} marker form(s), no rows matched`
              : `${fromSlot.toUpperCase()}'S DATA FOUND IN ${to.slot.toUpperCase()}: ${describeHits(hits)}`,
            dirFrom(fromSlot),
            'database-marker-scan'
          )
        )
        evidence[`databaseScanHits:${to.slot}`] = hits
      }
      controls.push(scanCoverage(results))
    }

    return decide({
      attempted,
      controls,
      leakReason:
        'bravo returned or stored data belonging to alpha. Because the two tenants collide on every ' +
        'human-readable field, this would be invisible to any check that did not compare ids.',
      onPass: {
        observed:
          `bravo's search for the colliding title returned only bravo's rows; alpha's canary matched ` +
          `nothing on bravo's public surfaces${bravo.db ? ' or anywhere in its database' : ''}`,
        reason: 'no row, id or canary belonging to either tenant is reachable from the other',
      },
      evidence,
    })
  },
}

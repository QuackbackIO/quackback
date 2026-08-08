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
import { control, decide, describeResponse, error, markersPresent } from './helpers'
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

    // --- negative: the colliding title on bravo -----------------------------
    const crossSearch = await bravo.http.request(searchPath(FIXTURE.postTitle), {
      omitCookies: true,
      expectsForeignMarkers: false,
    })
    const crossPosts = crossSearch.json<WidgetSearchBody>()?.data?.posts ?? []
    const alphaIds = new Set(
      [alpha.fixture?.postId, alpha.fixture?.boardId].filter(Boolean) as string[]
    )
    const foreignResults = crossPosts.filter(
      (p) => alphaIds.has(p.id) || (p.board?.id && alphaIds.has(p.board.id))
    )
    const bravoFoundOwn = crossPosts.some((p) => p.id === bravo.fixture?.postId)
    controls.push(
      control(
        'negative',
        `bravo search for the colliding title "${FIXTURE.postTitle}" returns only bravo's rows`,
        foreignResults.length === 0,
        foreignResults.length === 0
          ? `${crossPosts.length} result(s), all bravo's${bravoFoundOwn ? " (including bravo's own fixture post)" : ''}`
          : `ALPHA'S ROWS RETURNED: ${foreignResults.map((p) => p.id).join(', ')}`
      )
    )
    evidence.bravoSearchResultIds = crossPosts.map((p) => p.id)

    // --- negative: alpha's canary on bravo ----------------------------------
    const canarySearch = await bravo.http.request(searchPath(alpha.markers.canary), {
      omitCookies: true,
      expectsForeignMarkers: true,
    })
    const canaryPosts = canarySearch.json<WidgetSearchBody>()?.data?.posts ?? []
    controls.push(
      control(
        'negative',
        "bravo search for alpha's canary returns nothing",
        canaryPosts.length === 0,
        canaryPosts.length === 0
          ? 'no results'
          : `RETURNED ${canaryPosts.length} result(s): ${canaryPosts.map((p) => p.id).join(', ')}`
      )
    )

    // --- negative: portal documents on the shared board slug ----------------
    for (const path of ['/', `/b/${FIXTURE.boardSlug}`]) {
      const doc = await bravo.http.request(path, { omitCookies: true })
      const found = markersPresent(doc.text, alpha.markers)
      controls.push(
        control(
          'negative',
          `bravo GET ${path} contains no alpha marker`,
          found.length === 0,
          found.length === 0
            ? `HTTP ${doc.status}, clean`
            : `HTTP ${doc.status}, ALPHA MARKERS PRESENT: ${found.join(', ')}`
        )
      )
    }

    // --- negative: the whole of bravo's schema ------------------------------
    if (bravo.db) {
      const markers = [
        alpha.markers.canary,
        ...Object.values(alpha.markers.ids).flatMap(markerSearchForms),
      ]
      const hits: ScanHit[] = []
      const results: ScanResult[] = []
      for (const marker of markers) {
        if (marker.length < 8) continue
        const result = await scanForMarker(bravo.db, marker)
        hits.push(...result.hits)
        results.push(result)
      }
      controls.push(
        control(
          'negative',
          "bravo's database contains none of alpha's markers",
          hits.length === 0,
          hits.length === 0
            ? `scanned ${markers.length} marker form(s), no rows matched`
            : `ALPHA'S DATA FOUND IN BRAVO: ${describeHits(hits)}`
        )
      )
      controls.push(scanCoverage(results))
      evidence.databaseScanHits = hits
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
        reason: 'no row, id or canary belonging to alpha is reachable from bravo',
      },
      evidence,
    })
  },
}

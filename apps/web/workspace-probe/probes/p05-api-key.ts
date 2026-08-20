/**
 * P05 — alpha's API key against bravo's REST API.
 *
 * API keys are SHA-256 hashed and stored in the workspace's own `api_key` table,
 * resolved by a 12-character prefix and a timing-safe hash compare
 * (`api-key.service.ts:187`). Under pooled compute the lookup runs against
 * whichever pool workspace resolution returned. A miss is a 401 — but this probe
 * also cares about the more interesting outcome: a key that authenticates and
 * then reads the WRONG database, which returns a perfectly well-formed 200.
 *
 * So the probe does not stop at the status code. It compares the board and post
 * ids in every response against the marker vocabulary: a 200 from bravo carrying
 * alpha's board id is a leak, and so is a 200 from bravo carrying bravo's data
 * in response to alpha's credential.
 */

import {
  blocked,
  control,
  decide,
  dirFrom,
  describeResponse,
  halt,
  markersPresent,
} from './helpers'
import type { ControlOutcome, Probe, ProbeContext } from '../types'

const API_LEAK_REASON = 'a REST API credential issued by one workspace was honoured by the other'

interface BoardsBody {
  data?: Array<{ id: string; slug: string; name: string }>
  error?: { code?: string; message?: string }
}

export const p05ApiKey: Probe = {
  id: 'P05',
  name: 'api-key-cross-workspace',
  family: 'api',
  proves:
    'A REST API key issued by one workspace is rejected by the other with 401, and never returns data ' +
    'from either database — neither the issuing workspace’s rows (wrong pool) nor the target’s (wrong credential accepted).',
  requires: ['http', 'api-key'],

  async run(ctx: ProbeContext) {
    const { alpha, bravo, config } = ctx
    const attempted =
      "present alpha's REST API key to bravo's /api/v1 endpoints (and the reverse), on both a " +
      'scope-free listing endpoint and a data-bearing search'

    const alphaKey = config.alphaApiKey
    const bravoKey = config.bravoApiKey
    if (!alphaKey || !bravoKey) {
      return blocked({
        attempted,
        reason:
          'REST API keys for both workspaces are required. Pass --alpha-api-key and --bravo-api-key.',
      })
    }

    const controls: ControlOutcome[] = []
    controls.push(
      control(
        'invariant',
        'alpha and bravo hold different API keys',
        alphaKey !== bravoKey,
        alphaKey !== bravoKey
          ? 'distinct'
          : 'IDENTICAL — the same credential is valid in both workspaces'
      )
    )

    const bearer = (key: string) => ({ authorization: `Bearer ${key}` })

    // --- positive control ---------------------------------------------------
    const own = await alpha.http.request('/api/v1/boards', { headers: bearer(alphaKey) })
    const ownBoards = own.json<BoardsBody>()?.data ?? []
    const ownHasFixture = ownBoards.some((b) => b.id === alpha.fixture?.boardId)
    controls.push(
      control(
        'positive',
        "alpha's key → alpha GET /api/v1/boards",
        own.status === 200 && ownHasFixture,
        own.status === 200
          ? ownHasFixture
            ? `200 with ${ownBoards.length} boards including alpha's fixture board`
            : `200 but alpha's fixture board ${alpha.fixture?.boardId} was absent`
          : describeResponse(own, 200)
      )
    )
    if (own.status !== 200 || !ownHasFixture) {
      // Through `decide()`: the "keys differ" invariant is already recorded, and
      // one API key serving both workspaces is a cross-workspace capability regardless
      // of whether the listing endpoint answered.
      return halt({
        attempted,
        controls,
        stopped: {
          label: "alpha's key → alpha GET /api/v1/boards",
          detail: describeResponse(own, 300),
        },
        reason:
          'the positive control failed: alpha’s own key did not read alpha’s own boards, so a 401 ' +
          'from bravo would be indistinguishable from a dead credential.',
        leakReason: API_LEAK_REASON,
      })
    }

    // --- negative: listing endpoint ----------------------------------------
    const crossAtoB = await bravo.http.request('/api/v1/boards', {
      headers: bearer(alphaKey),
      expectsForeignMarkers: true,
    })
    const crossBody = crossAtoB.json<BoardsBody>()
    const crossBoards = crossBody?.data ?? []
    const alphaMarkers = markersPresent(crossAtoB.text, alpha.markers)
    const servedBravoData = crossBoards.some((b) => b.id === bravo.fixture?.boardId)

    let crossDetail: string
    let crossOk: boolean
    if (crossAtoB.status === 401) {
      crossOk = true
      crossDetail = `refused with 401 ${crossBody?.error?.code ?? ''}`.trim()
    } else if (alphaMarkers.length > 0) {
      crossOk = false
      crossDetail = `HTTP ${crossAtoB.status} carrying ALPHA's rows: ${alphaMarkers.join(', ')} — bravo's hostname read alpha's database`
    } else if (servedBravoData) {
      crossOk = false
      crossDetail = `HTTP ${crossAtoB.status} carrying BRAVO's rows — alpha's key authenticated against bravo's workspace`
    } else {
      crossOk = false
      crossDetail = `HTTP ${crossAtoB.status}, expected 401: ${describeResponse(crossAtoB, 200)}`
    }
    controls.push(
      control(
        'negative',
        "alpha's key → bravo GET /api/v1/boards",
        crossOk,
        crossDetail,
        'a-to-b',
        'api-key-boards-listing'
      )
    )

    // --- negative: the reverse direction ------------------------------------
    const crossBtoA = await alpha.http.request('/api/v1/boards', {
      headers: bearer(bravoKey),
      expectsForeignMarkers: true,
    })
    controls.push(
      control(
        'negative',
        "bravo's key → alpha GET /api/v1/boards",
        crossBtoA.status === 401,
        crossBtoA.status === 401
          ? 'refused with 401'
          : `HTTP ${crossBtoA.status}, expected 401: ${describeResponse(crossBtoA, 200)}`,
        'b-to-a',
        'api-key-boards-listing'
      )
    )

    // --- negative: a data-bearing endpoint, searched for the foreign canary --
    // If a key were honoured against the wrong pool, this is where a real row
    // would surface. Both directions: an asymmetric test lets a shared key
    // table hide behind whichever lookup happens to resolve.
    for (const [fromSlot, toSlot, from, to, key] of [
      ['alpha', 'bravo', alpha, bravo, alphaKey],
      ['bravo', 'alpha', bravo, alpha, bravoKey],
    ] as const) {
      const search = await to.http.request(
        `/api/v1/posts?search=${encodeURIComponent(from.markers.canary)}&limit=20`,
        { headers: bearer(key), expectsForeignMarkers: true }
      )
      const results = search.json<{ data?: Array<{ id: string; title: string }> }>()?.data ?? []
      const returnedForeignPost = results.some((p) => p.id === from.fixture?.postId)
      controls.push(
        control(
          'negative',
          `${fromSlot}'s key → ${toSlot} GET /api/v1/posts?search=<${fromSlot} canary>`,
          search.status === 401 || (results.length === 0 && !returnedForeignPost),
          search.status === 401
            ? 'refused with 401'
            : returnedForeignPost
              ? `returned ${fromSlot.toUpperCase()}'s fixture post ${from.fixture?.postId}`
              : `HTTP ${search.status} with ${results.length} result(s), expected 401`,
          dirFrom(fromSlot),
          'api-key-canary-search'
        )
      )
    }

    return decide({
      attempted,
      controls,
      leakReason: API_LEAK_REASON,
      onPass: {
        observed: "each workspace answered the other's API key with 401 on every endpoint tried",
        reason: 'API keys resolve only against the workspace database that issued them',
      },
    })
  },
}

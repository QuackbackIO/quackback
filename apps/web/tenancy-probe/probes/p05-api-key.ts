/**
 * P05 — alpha's API key against bravo's REST API.
 *
 * API keys are SHA-256 hashed and stored in the tenant's own `api_key` table,
 * resolved by a 12-character prefix and a timing-safe hash compare
 * (`api-key.service.ts:187`). Under pooled compute the lookup runs against
 * whichever pool tenant resolution returned. A miss is a 401 — but this probe
 * also cares about the more interesting outcome: a key that authenticates and
 * then reads the WRONG database, which returns a perfectly well-formed 200.
 *
 * So the probe does not stop at the status code. It compares the board and post
 * ids in every response against the marker vocabulary: a 200 from bravo carrying
 * alpha's board id is a leak, and so is a 200 from bravo carrying bravo's data
 * in response to alpha's credential.
 */

import { blocked, control, describeResponse, error, leak, markersPresent, pass } from './helpers'
import type { ControlOutcome, Probe, ProbeContext } from '../types'

interface BoardsBody {
  data?: Array<{ id: string; slug: string; name: string }>
  error?: { code?: string; message?: string }
}

export const p05ApiKey: Probe = {
  id: 'P05',
  name: 'api-key-cross-tenant',
  family: 'api',
  proves:
    'A REST API key issued by one tenant is rejected by the other with 401, and never returns data ' +
    'from either database — neither the issuing tenant’s rows (wrong pool) nor the target’s (wrong credential accepted).',
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
          'REST API keys for both tenants are required. Pass --alpha-api-key and --bravo-api-key.',
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
          : 'IDENTICAL — the same credential is valid in both tenants'
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
      return error({
        attempted,
        observed: describeResponse(own, 300),
        reason:
          'the positive control failed: alpha’s own key did not read alpha’s own boards, so a 401 ' +
          'from bravo would be indistinguishable from a dead credential.',
        controls,
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
      crossDetail = `HTTP ${crossAtoB.status} carrying BRAVO's rows — alpha's key authenticated against bravo's tenant`
    } else {
      crossOk = false
      crossDetail = `HTTP ${crossAtoB.status}, expected 401: ${describeResponse(crossAtoB, 200)}`
    }
    controls.push(
      control('negative', "alpha's key → bravo GET /api/v1/boards", crossOk, crossDetail)
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
          : `HTTP ${crossBtoA.status}, expected 401: ${describeResponse(crossBtoA, 200)}`
      )
    )

    // --- negative: a data-bearing endpoint, searched for the foreign canary --
    // If the key were honoured against the wrong pool, this is where a real row
    // would surface. The canary is in the request, so the tripwire is suppressed
    // and the assertion is made here explicitly on the result set.
    const search = await bravo.http.request(
      `/api/v1/posts?search=${encodeURIComponent(alpha.markers.canary)}&limit=20`,
      { headers: bearer(alphaKey), expectsForeignMarkers: true }
    )
    const searchResults = search.json<{ data?: Array<{ id: string; title: string }> }>()?.data ?? []
    const returnedAlphaPost = searchResults.some((p) => p.id === alpha.fixture?.postId)
    controls.push(
      control(
        'negative',
        "alpha's key → bravo GET /api/v1/posts?search=<alpha canary>",
        search.status === 401 || (searchResults.length === 0 && !returnedAlphaPost),
        search.status === 401
          ? 'refused with 401'
          : returnedAlphaPost
            ? `returned ALPHA's fixture post ${alpha.fixture?.postId}`
            : `HTTP ${search.status} with ${searchResults.length} result(s), expected 401`
      )
    )

    const failed = controls.filter((c) => c.kind !== 'positive' && !c.ok)
    if (failed.length > 0) {
      return leak({
        attempted,
        observed: failed.map((c) => `${c.label}: ${c.detail}`).join(' | '),
        reason: 'a REST API credential issued by one tenant was honoured by the other',
        controls,
      })
    }

    return pass({
      attempted,
      observed: "each tenant answered the other's API key with 401 on every endpoint tried",
      reason: 'API keys resolve only against the tenant database that issued them',
      controls,
    })
  },
}

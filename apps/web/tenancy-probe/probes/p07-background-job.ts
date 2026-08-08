/**
 * P07 — a background job enqueued for alpha executing against bravo's database.
 *
 * Under the pooled design the worker tier is shared: one always-warm
 * `QUACKBACK_ROLE=worker` fleet drains queues for every tenant
 * (SAAS-HOSTING-STACK.md §1, §5 caveat 3). A job carries no request scope, so
 * whatever tenant the worker's `db` resolves to is the tenant the job writes to.
 * There is no second gate — the write succeeds, against the wrong database.
 *
 * The probe drives a real write on alpha through the REST API, lets the derived
 * background work settle, and then asks a question that needs no knowledge of
 * which queue ran: does anything anywhere in bravo's database now reference
 * alpha's row?
 *
 * The positive control is what makes a null answer meaningful. It requires that
 * alpha's OWN database gained a derived row — a row in some table other than
 * `posts` referencing the post id. If no background side effect is observable at
 * all, the probe is blind and says so instead of passing.
 */

import {
  scanForMarker,
  describeHits,
  scanCoverage,
  FIXTURE_TABLES,
  type ScanHit,
  type ScanResult,
} from '../db-scan'
import { markerSearchForms } from '../db'
import { blocked, control, decide, dirFrom, describeResponse, error } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, TenantHandle } from '../types'

/** How long to let queues and the outbox relay settle before scanning. */
const SETTLE_MS = 4000

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

interface AggregateScan {
  hits: ScanHit[]
  results: ScanResult[]
}

async function scanAll(handle: TenantHandle, markers: string[]): Promise<AggregateScan> {
  const hits: ScanHit[] = []
  const results: ScanResult[] = []
  for (const marker of markers) {
    const result = await scanForMarker(handle.db!, marker)
    hits.push(...result.hits)
    results.push(result)
  }
  return { hits, results }
}

export const p07BackgroundJob: Probe = {
  id: 'P07',
  name: 'background-job-cross-tenant-write',
  family: 'jobs',
  proves:
    'A write driven on alpha produces derived background rows in alpha’s database and none at all in ' +
    'bravo’s — no queue, outbox, activity or notification row referencing alpha’s entity exists on the other side.',
  requires: ['http', 'api-key', 'db'],
  poolingCaveat:
    'Today each tenant runs its own worker process bound to one DATABASE_URL, so a job physically ' +
    'cannot reach the other database. This probe becomes the real test when one shared worker tier ' +
    'drains queues for every tenant; until then it establishes the observation baseline and proves ' +
    'the scan can actually see derived rows.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo, config } = ctx
    const attempted =
      "drive an idempotent update to alpha's fixture post through the REST API, wait for the derived " +
      "background work to settle, then scan bravo's entire content, event, conversation and job schema " +
      "for any reference to alpha's post"

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both tenant database URLs are required: whether a job wrote to the wrong database is a ' +
          'row-level question and cannot be observed over HTTP. Pass --alpha-db and --bravo-db.',
      })
    }
    if (!config.alphaApiKey || !alpha.fixture) {
      return blocked({
        attempted,
        reason: 'alpha’s REST API key and provisioned fixture are required to drive the write',
      })
    }

    const controls: ControlOutcome[] = []

    // --- drive the write on BOTH tenants ------------------------------------
    // Updates rather than creates, so a second run re-triggers the same
    // background work without accumulating rows and changing the next verdict.
    // Both tenants are driven before the settle, so the symmetric check costs
    // one settle window rather than two.
    for (const handle of [alpha, bravo]) {
      const key = handle.slot === 'alpha' ? config.alphaApiKey : config.bravoApiKey
      if (!key || !handle.fixture) {
        return blocked({
          attempted,
          reason: `${handle.slot}'s REST API key and provisioned fixture are required to drive the write`,
        })
      }
      const update = await handle.http.request(`/api/v1/posts/${handle.fixture.postId}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify({ content: handle.fixture.postBody }),
      })
      if (update.status >= 400) {
        return error({
          attempted,
          observed: `${handle.slot}: ${describeResponse(update, 300)}`,
          reason:
            'the write that was supposed to enqueue background work was rejected, so nothing was ' +
            'enqueued and no conclusion about job routing is available',
          controls,
        })
      }
    }
    await settle(SETTLE_MS)

    const allScans: ScanResult[] = []
    const derivedTables = new Set<string>()

    for (const [ownerSlot, owner, other] of [
      ['alpha', alpha, bravo],
      ['bravo', bravo, alpha],
    ] as const) {
      const postId = owner.fixture!.postId
      const postIdForms = markerSearchForms(postId)

      // --- positive control: the write is observable at all -----------------
      //
      // Scanned by POST ID ONLY, with the tables the fixture itself occupies
      // excluded. An earlier version also scanned for the canary and counted any
      // non-`posts` hit as a derived row — but the fixture writes that canary
      // into `boards.description`, so `boards` satisfied the guard and the probe
      // returned PASS against a deployment with background processing switched
      // off entirely. A visibility guard has to be satisfied by the write under
      // test, never by fixture data that was already sitting there.
      const ownScan = await scanAll(owner, postIdForms)
      allScans.push(...ownScan.results)
      const derived = ownScan.hits.filter((h) => !FIXTURE_TABLES.has(h.table))
      for (const hit of derived) derivedTables.add(hit.table)
      controls.push(
        control(
          'positive',
          `${ownerSlot}'s database gained derived rows referencing its post`,
          derived.length > 0,
          derived.length > 0
            ? `derived rows in ${describeHits(derived)}`
            : `the post id appeared only in the fixture's own tables (${describeHits(ownScan.hits) || 'nothing'}) — ` +
                `no background side effect is observable, so a clean scan of the other tenant would prove nothing`
        )
      )
      if (derived.length === 0) {
        return error({
          attempted,
          observed: `${ownerSlot} scan matched ${describeHits(ownScan.hits) || 'nothing'} outside the fixture tables`,
          reason:
            'the write produced no observable derived rows in its own database within the settle window, ' +
            'so this probe is blind: an absence of rows in the other tenant would be equally explained ' +
            'by there being no background work at all. Not a pass.',
          controls,
        })
      }

      // --- negative: nothing of this tenant's reached the other -------------
      // Deliberately wider than the visibility scan: any trace, by id or by
      // canary, is a finding wherever it landed.
      const foreignScan = await scanAll(other, [...postIdForms, owner.markers.canary])
      allScans.push(...foreignScan.results)
      controls.push(
        control(
          'negative',
          `${other.slot}'s database contains no reference to ${ownerSlot}'s post or canary`,
          foreignScan.hits.length === 0,
          foreignScan.hits.length === 0
            ? 'no rows matched in any scanned table'
            : `${ownerSlot.toUpperCase()}'S DATA FOUND IN ${other.slot.toUpperCase()}: ${describeHits(foreignScan.hits)}`,
          dirFrom(ownerSlot),
          'derived-row-cross-scan'
        )
      )
    }

    controls.push(scanCoverage(allScans))

    return decide({
      attempted,
      controls,
      leakReason:
        'background work driven by one tenant left rows in the other tenant’s database. Under a ' +
        'shared worker tier this is silent — the write succeeds and nothing errors.',
      onPass: {
        observed:
          `both tenants gained derived rows (${[...derivedTables].join(', ')}) and neither database ` +
          'contained any trace of the other',
        reason: 'background work driven on each tenant wrote only to that tenant’s database',
      },
      evidence: { derivedTables: [...derivedTables] },
    })
  },
}

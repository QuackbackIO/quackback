/**
 * P07 — a background job enqueued for alpha executing against bravo's database.
 *
 * Under the pooled design the worker tier is shared: one always-warm
 * `QUACKBACK_ROLE=worker` fleet drains queues for every workspace
 * (SAAS-HOSTING-STACK.md §1, §5 caveat 3). A job carries no request scope, so
 * whatever workspace the worker's `db` resolves to is the workspace the job writes to.
 * There is no second gate — the write succeeds, against the wrong database.
 *
 * The probe drives a real write on each workspace through the REST API, lets the
 * derived background work settle, and then asks a question that needs no
 * knowledge of which queue ran: does anything anywhere in the other workspace's
 * database now reference this one's row?
 *
 * The positive control is what makes a null answer meaningful, and it is keyed
 * on a token minted fresh for THIS RUN. See `mintDriveToken` for why nothing
 * weaker survives contact with a real fleet.
 */

import { randomBytes } from 'node:crypto'
import {
  scanForMarker,
  describeHits,
  scanCoverage,
  FIXTURE_TABLES,
  type ScanHit,
  type ScanResult,
} from '../db-scan'
import { markerSearchForms } from '../db'
import { blocked, control, decide, dirFrom, describeResponse, halt } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, WorkspaceHandle, WorkspaceSlot } from '../types'

/** How long to let queues and the outbox relay settle before scanning. */
const SETTLE_MS = 4000

const JOB_LEAK_REASON =
  'background work driven by one workspace left rows in the other workspace’s database. Under a ' +
  'shared worker tier this is silent — the write succeeds and nothing errors.'

/**
 * A token minted fresh for this run, stamped into the content of the write that
 * drives the background work.
 *
 * This is the guard, and it exists because the version without it reported PASS
 * against a fleet where nothing had happened at all. That probe drove the work
 * by PATCHing the fixture post with the content the post ALREADY HAD. The
 * request was accepted (< 400) and changed nothing: measured on the live fleet,
 * `posts.updated_at` had not moved in two days, and the only `events` and
 * `post_activity` rows referencing either fixture post were the `post.created`
 * rows from when the fixture was provisioned. The positive control — "this
 * workspace's database gained derived rows referencing its post" — was satisfied
 * entirely by those two-day-old rows, and the probe passed while the hazard it
 * exists to detect went completely unexercised.
 *
 * A per-run token closes both halves of that at once:
 *
 *  - It cannot exist unless the write actually happened, so a drive that did
 *    nothing leaves nothing to find. WORK WAS DRIVEN is established, not assumed.
 *  - It is different every run, so a row left by an EARLIER run cannot satisfy
 *    it. The evidence is provably this run's.
 *
 * It is deliberately preferred over requiring the derived row to postdate the
 * write, which was the other candidate. That comparison closes only the second
 * hole, needs a clock both sides agree on (the probe's wall clock against each
 * workspace database's `now()` is exactly the skew-sensitive comparison a probe
 * should not be making), and can still be satisfied by an unrelated concurrent
 * write that merely happens to be newer. Freshness by construction needs no
 * clock at all: the token did not exist before this run, so any row containing
 * it postdates the write by definition.
 *
 * Lowercase alphanumeric, like the canaries, so Postgres full-text tokenisation
 * cannot split it and the scan can match it verbatim.
 */
function mintDriveToken(slot: WorkspaceSlot): string {
  return `qbprobedrive${slot}${randomBytes(6).toString('hex')}`
}

function driveContent(token: string): string {
  return `Workspace isolation probe drive ${token}. Safe to delete.`
}

/**
 * The table the drive write lands in ITSELF.
 *
 * Excluded from the visibility guard alongside `FIXTURE_TABLES`, and for a
 * sharper reason than those: the row the write created is proof the write
 * happened, not proof it drove anything. A guard satisfied by it would certify
 * "background work is observable" on a deployment whose background processing
 * was switched off entirely — the write would land its own row and nothing else,
 * and the probe would pass having proven only that a synchronous insert stayed
 * where it was put. What counts as derived is a row SOMETHING ELSE wrote as a
 * consequence: the `comment.created` outbox row the shared worker relay drains,
 * and whatever that fans out to.
 */
const DRIVE_TABLES = new Set(['post_comments'])

function isDerived(table: string): boolean {
  return !FIXTURE_TABLES.has(table) && !DRIVE_TABLES.has(table)
}

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

interface AggregateScan {
  hits: ScanHit[]
  results: ScanResult[]
}

async function scanAll(handle: WorkspaceHandle, markers: string[]): Promise<AggregateScan> {
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
  name: 'background-job-cross-workspace-write',
  family: 'jobs',
  proves:
    'A write driven on alpha produces derived background rows carrying THIS RUN’s drive token in ' +
    'alpha’s database and none at all in bravo’s — no queue, outbox, activity or notification row ' +
    'referencing alpha’s entity or its drive token exists on the other side.',
  requires: ['http', 'api-key', 'db'],
  poolingCaveat:
    'The worker tier on this fleet is already shared: one worker service, one replica, and no ' +
    'per-workspace DATABASE_URL, so a misrouted job CAN reach the other database and this probe is ' +
    'load-bearing today. What remains over-determined is narrower: the probe observes rows, not ' +
    'processes, so it cannot tell "the worker resolved the right workspace" from "the worker resolved ' +
    'the wrong one and the write happened to fail" — nor can it see a job that ran against the ' +
    'wrong workspace and only READ. A clean result here is evidence about writes reaching the wrong ' +
    'database, and about nothing else the worker tier does.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo, config } = ctx
    const attempted =
      "post a comment carrying a freshly minted per-run drive token to each workspace's fixture post " +
      'through the REST API, wait for the derived background work to settle, then scan each ' +
      "workspace's entire content, event, conversation and job schema for any reference to the other " +
      'workspace’s post or drive token'

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both workspace database URLs are required: whether a job wrote to the wrong database is a ' +
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
    const driveTokens: Record<string, string> = {}

    // --- drive the write on BOTH workspaces ------------------------------------
    //
    // A comment on the fixture post, NOT an update of the post itself. The
    // previous drive was an "idempotent" PATCH of the post content, chosen so a
    // second run would not accumulate rows — but idempotent is precisely the
    // problem: it re-sent content the post already had and drove nothing. Worse,
    // even a PATCH that genuinely mutates is the wrong lever here: a content
    // edit's only background work is an embedding regeneration
    // (`post.service.ts`, `generatePostEmbedding`), which writes a vector column
    // on `posts` itself — inside the fixture tables, in a column type the scan
    // does not read. It could never have satisfied an honest visibility guard.
    //
    // A comment write lands a row in `post_comments` and emits a `comment.created`
    // event whose payload carries both the post reference and the comment content
    // (`events/types.ts`, CommentCreatedPayload). The event row is the durable
    // outbox row the shared worker relay drains, which is the exact path this
    // probe is about. Both rows carry the drive token, so the token alone
    // identifies this run's derived work.
    //
    // Both workspaces are driven before the settle, so the symmetric check costs one
    // settle window rather than two. Each run leaves one comment per workspace;
    // `--teardown` removes the fixture post and its comments with it.
    for (const handle of [alpha, bravo]) {
      const key = handle.slot === 'alpha' ? config.alphaApiKey : config.bravoApiKey
      if (!key || !handle.fixture) {
        return blocked({
          attempted,
          controls,
          reason: `${handle.slot}'s REST API key and provisioned fixture are required to drive the write`,
        })
      }
      const token = mintDriveToken(handle.slot)
      driveTokens[handle.slot] = token
      const drive = await handle.http.request(`/api/v1/posts/${handle.fixture.postId}/comments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify({ content: driveContent(token) }),
      })
      if (drive.status >= 400) {
        return halt({
          attempted,
          controls,
          stopped: {
            label: 'the write that drives background work was accepted on both workspaces',
            detail: `${handle.slot}: ${describeResponse(drive, 300)}`,
          },
          reason:
            'the write that was supposed to enqueue background work was rejected, so nothing was ' +
            'enqueued and no conclusion about job routing is available. A 401/403 here means the ' +
            'REST API key lacks the comment-moderate permission; grant it and re-run.',
          leakReason: JOB_LEAK_REASON,
          evidence: { driveTokens },
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
      const token = driveTokens[ownerSlot]!

      // --- positive control: THIS RUN's write is observable at all -----------
      //
      // Scanned by the run's drive token, with the tables the fixture occupies
      // and the table the write itself lands in both excluded (`isDerived`).
      //
      // Those exclusions are second, independent guards and not the main one. The
      // fixture-table exclusion
      // closes only the STATIC-fixture case: an earlier version scanned for the
      // canary and counted any non-`posts` hit as derived, and because the
      // fixture writes that canary into `boards.description`, `boards` satisfied
      // the guard on a deployment with background processing switched off
      // entirely. What the exclusion never closed is the STALE-derived-row case,
      // where a genuine derived row from an EARLIER run — a `post_activity` row
      // in a table no exclusion list would ever name — sits there satisfying a
      // scan keyed on the post id, which is the same on every run. Only the
      // per-run token closes that, because it did not exist until a moment ago.
      const ownScan = await scanAll(owner, [token])
      allScans.push(...ownScan.results)
      const derived = ownScan.hits.filter((h) => isDerived(h.table))
      for (const hit of derived) derivedTables.add(hit.table)

      if (derived.length === 0) {
        // Scanned only to explain the failure: if the post id still matches rows
        // this run did not write, saying so is the difference between "there is
        // no background processing here" and "you were reading an earlier run's
        // evidence", and an operator needs to know which.
        const staleScan = await scanAll(owner, postIdForms)
        allScans.push(...staleScan.results)
        const stale = staleScan.hits.filter((h) => isDerived(h.table))
        const landed = ownScan.hits.filter((h) => DRIVE_TABLES.has(h.table))
        const detail =
          (landed.length > 0
            ? `the drive write itself landed (this run's token is in ${describeHits(landed)}) but ` +
              `nothing was derived from it. `
            : `this run's drive token appears nowhere in ${ownerSlot}'s database. `) +
          (stale.length > 0
            ? `The post id still matches ${describeHits(stale)}, but those rows were not written by ` +
              `this run — a scan keyed on the post id would have accepted them and passed.`
            : 'The post id matches nothing derived either.')
        controls.push(
          control(
            'positive',
            `${ownerSlot}'s database gained derived rows carrying this run's drive token`,
            false,
            detail
          )
        )
        return halt({
          attempted,
          controls,
          stopped: {
            label: `${ownerSlot}'s own database gained an observable derived row from THIS run`,
            detail,
          },
          reason:
            'the write produced no observable derived rows carrying this run’s drive token within ' +
            'the settle window, so this probe is blind: an absence of rows in the other workspace ' +
            'would be equally explained by there being no background work at all. Not a pass. If ' +
            'comment moderation is enabled for this board, the comment is held and its event is ' +
            'deferred until approval — that is the one benign explanation, and it still leaves the ' +
            'probe unable to see.',
          leakReason: JOB_LEAK_REASON,
          evidence: { driveTokens },
        })
      }

      controls.push(
        control(
          'positive',
          `${ownerSlot}'s database gained derived rows carrying this run's drive token`,
          true,
          `derived rows in ${describeHits(derived)}`
        )
      )

      // --- negative: nothing of this workspace's reached the other -------------
      // Deliberately wider than the visibility scan: any trace — by id, by
      // canary, or by this run's drive token — is a finding wherever it landed.
      const foreignScan = await scanAll(other, [...postIdForms, owner.markers.canary, token])
      allScans.push(...foreignScan.results)
      controls.push(
        control(
          'negative',
          `${other.slot}'s database contains no reference to ${ownerSlot}'s post, canary or drive token`,
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
      leakReason: JOB_LEAK_REASON,
      onPass: {
        observed:
          `both workspaces gained derived rows carrying this run's drive token ` +
          `(${[...derivedTables].join(', ')}) and neither database contained any trace of the other`,
        reason: 'background work driven on each workspace wrote only to that workspace’s database',
      },
      evidence: { derivedTables: [...derivedTables], driveTokens },
    })
  },
}

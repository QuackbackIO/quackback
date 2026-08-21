/**
 * P09 — the assistant's service principal id from alpha written into bravo's rows.
 *
 * `assistant.orchestrator.ts:62` memoises `memoizedAssistantPrincipalId` in
 * module scope, with a sibling memo in `messages/assistant-principal.ts:16-17`.
 * The value is a `principal.id` from whichever workspace's database happened to be
 * resolved first after boot. SAAS-HOSTING-STACK.md §4.1 spells out the
 * consequence: it is then written as a foreign key into another workspace's
 * `conversation_messages`, `assistant_involvements` and workflow action rows —
 * "FK violation, or silent misattribution".
 *
 * Silent misattribution is the case worth catching. If bravo happens to hold a
 * principal row with the same id — impossible today, entirely possible after a
 * restore, a clone, or a seeded fixture — the FK is satisfied and Quinn's
 * replies in bravo are attributed to a principal from alpha. Nothing errors.
 */

import { ASSISTANT_PRINCIPAL_SQL, markerSearchForms, typeId } from '../db'
import {
  scanForMarker,
  describeHits,
  scanCoverage,
  type ScanHit,
  type ScanResult,
} from '../db-scan'
import { blocked, control, decide, dirFrom } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, WorkspaceHandle } from '../types'

async function assistantPrincipalId(handle: WorkspaceHandle): Promise<string | null> {
  if (!handle.db) return null
  const [row] = await handle.db.query<{ id: string }>(ASSISTANT_PRINCIPAL_SQL)
  if (!row) return null
  return typeId('principal', row.id)
}

export const p09AssistantPrincipal: Probe = {
  id: 'P09',
  name: 'assistant-service-principal-cross-workspace',
  family: 'assistant',
  proves:
    'Each workspace’s assistant service principal is its own row, and neither workspace’s database contains ' +
    'a single reference to the other’s assistant principal id in any column of any content, ' +
    'conversation or attribution table.',
  requires: ['db'],
  poolingCaveat:
    'The memo this targets is process-scoped, so it can only be poisoned once one process serves both ' +
    'workspaces. Today the probe proves the two ids are distinct and unreferenced, which is the baseline ' +
    'the pooled check will be measured against.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      "read each workspace's assistant service principal id and search the other workspace's entire " +
      'content, conversation and attribution schema for it, in both TypeID and uuid form'

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both workspace database URLs are required: the assistant principal id is never exposed over ' +
          'HTTP, and misattribution is a foreign-key-level fact. Pass --alpha-db and --bravo-db.',
      })
    }

    const alphaId = await assistantPrincipalId(alpha)
    const bravoId = await assistantPrincipalId(bravo)

    if (!alphaId || !bravoId) {
      return blocked({
        attempted,
        reason:
          `the assistant service principal is provisioned lazily on first use and is missing on ` +
          `${!alphaId ? 'alpha' : ''}${!alphaId && !bravoId ? ' and ' : ''}${!bravoId ? 'bravo' : ''}. ` +
          'It has no provisioning path this suite can drive. `ensureAssistantPrincipal()` is ' +
          'reached only from a genuine assistant interaction — an assistant turn in a conversation, ' +
          'an AI classification, a Copilot question, or a workflow plan containing a send_block ' +
          'action — every one of which requires the workspace to have an AI provider configured and ' +
          'the relevant feature enabled. No REST endpoint provisions it, so the fixture cannot, and ' +
          'writing a principal row straight into the workspace database would be a fixture the ' +
          'application would never create: it would satisfy this probe while proving nothing about ' +
          'the memo that poisons it. To unblock, configure AI on both workspaces and ask Quinn one ' +
          'question in each, then re-run. Reported as blocked rather than passed: an absent ' +
          'principal cannot be misattributed, which is not the same as isolation being proven.',
      })
    }

    const controls: ControlOutcome[] = []
    controls.push(
      control(
        'invariant',
        'the two workspaces have distinct assistant principal ids',
        alphaId !== bravoId,
        alphaId !== bravoId
          ? `alpha ${alphaId}, bravo ${bravoId}`
          : `IDENTICAL (${alphaId}) — a memoised id from either workspace satisfies the foreign key in both, so misattribution would be undetectable at the database level`
      )
    )

    // The uuid form is essential: principal.id is a native uuid column, so a
    // scan for the TypeID string alone matches nothing and would always "pass".
    for (const [owner, foreign, id] of [
      ['alpha', bravo, alphaId],
      ['bravo', alpha, bravoId],
    ] as const) {
      const forms = markerSearchForms(id)
      const hits: ScanHit[] = []
      const results: ScanResult[] = []
      for (const form of forms) {
        const result = await scanForMarker(foreign.db!, form)
        hits.push(...result.hits)
        results.push(result)
      }
      // The foreign workspace's own `principal` table legitimately contains its own
      // assistant row; a hit there for the OTHER workspace's id is what matters, and
      // the id forms differ, so any hit at all is a genuine cross-workspace reference.
      controls.push(
        control(
          'negative',
          `${owner}'s assistant principal id appears nowhere in ${foreign.slot}'s database`,
          hits.length === 0,
          hits.length === 0
            ? `searched ${forms.length} id form(s) across the content and attribution tables, no rows matched`
            : `FOUND IN ${foreign.slot.toUpperCase()}: ${describeHits(hits)}`,
          dirFrom(owner),
          'assistant-principal-cross-scan'
        )
      )
      controls.push(scanCoverage(results))
    }

    return decide({
      attempted,
      controls,
      leakReason:
        'one workspace’s assistant service principal is referenced by, or indistinguishable from, the ' +
        'other’s. Every assistant reply, involvement and workflow action attributed through it is ' +
        'attributed across the workspace boundary.',
      onPass: {
        observed: `alpha ${alphaId} and bravo ${bravoId} are distinct and neither appears in the other's database`,
        reason: 'assistant attribution is confined to the workspace that owns the principal row',
      },
      evidence: { alphaAssistantPrincipalId: alphaId, bravoAssistantPrincipalId: bravoId },
    })
  },
}

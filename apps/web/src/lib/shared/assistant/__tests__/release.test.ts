/**
 * The publication gate and the affected-use diff, as pure functions.
 *
 * The gate is the part that has to be right whatever the runner does: a
 * required check that was not run, was run against a different candidate, or
 * came back anything other than passed must block, and the reason it blocks
 * has to be the one a reviewer is shown.
 */
import { describe, it, expect } from 'vitest'
import {
  RELEASE_CHECKS,
  evaluateReleaseGate,
  releaseAffectedUses,
  type ReleaseCheckResult,
} from '../release'

const CANDIDATE = 'hash-candidate'
const OLDER = 'hash-older'

function passingRequired(hash = CANDIDATE): ReleaseCheckResult[] {
  return RELEASE_CHECKS.filter((check) => check.required).map((check) => ({
    key: check.key,
    status: 'passed' as const,
    candidateHash: hash,
    summary: null,
    ranAt: '2026-09-19T00:00:00.000Z',
  }))
}

describe('evaluateReleaseGate', () => {
  it('passes only when every required check passed against this candidate', () => {
    const gate = evaluateReleaseGate(CANDIDATE, passingRequired())
    expect(gate.publishable).toBe(true)
    expect(gate.blocking).toEqual([])
  })

  it('blocks a candidate no required check has been run for', () => {
    const gate = evaluateReleaseGate(CANDIDATE, [])
    expect(gate.publishable).toBe(false)
    expect(gate.blocking.map((entry) => entry.reason)).toEqual(
      RELEASE_CHECKS.filter((check) => check.required).map(() => 'not_run')
    )
  })

  it('reads evidence from an earlier candidate as stale rather than as a pass', () => {
    const gate = evaluateReleaseGate(CANDIDATE, passingRequired(OLDER))
    expect(gate.publishable).toBe(false)
    expect(gate.blocking.every((entry) => entry.reason === 'stale')).toBe(true)
  })

  it.each(['failed', 'skipped', 'inconclusive', 'running', 'cancelled'] as const)(
    'blocks on a required check that came back %s',
    (status) => {
      const results = passingRequired()
      results[0] = { ...results[0], status }
      const gate = evaluateReleaseGate(CANDIDATE, results)
      expect(gate.publishable).toBe(false)
      expect(gate.blocking).toEqual([{ key: results[0].key, reason: status }])
    }
  )

  it('does not block on an optional check that failed', () => {
    const optional = RELEASE_CHECKS.find((check) => !check.required)
    if (!optional) throw new Error('the catalogue needs an optional check for this case')
    const gate = evaluateReleaseGate(CANDIDATE, [
      ...passingRequired(),
      {
        key: optional.key,
        status: 'failed',
        candidateHash: CANDIDATE,
        summary: null,
        ranAt: '2026-09-19T00:00:00.000Z',
      },
    ])
    expect(gate.publishable).toBe(true)
  })

  it('ignores a result whose key left the catalogue', () => {
    const gate = evaluateReleaseGate(CANDIDATE, [
      ...passingRequired(),
      {
        key: 'retired_check',
        status: 'failed',
        candidateHash: CANDIDATE,
        summary: null,
        ranAt: '2026-09-19T00:00:00.000Z',
      },
    ])
    expect(gate.publishable).toBe(true)
  })
})

describe('releaseAffectedUses', () => {
  const base = {
    version: 4,
    identity: { name: 'Quinn', avatarUrl: null },
    agents: {
      agent: { voice: { tone: 'balanced' }, knowledge: { helpCenter: true }, toolRules: {} },
      copilot: { capabilities: { qa: true }, knowledge: { posts: true }, toolRules: {} },
      workspace: { instructions: '', knowledge: { posts: true }, toolRules: {} },
    },
  }

  it('reports nothing for an unchanged candidate', () => {
    expect(releaseAffectedUses(base, structuredClone(base))).toEqual({ uses: [], changedPaths: [] })
  })

  it('attributes an agent change to customer conversations only', () => {
    const next = structuredClone(base)
    next.agents.agent.voice.tone = 'formal'
    const scope = releaseAffectedUses(base, next)
    expect(scope.uses).toEqual(['customer'])
    expect(scope.changedPaths).toEqual(['agents.agent.voice.tone'])
  })

  it('attributes a copilot change to support teammates only', () => {
    const next = structuredClone(base)
    next.agents.copilot.knowledge.posts = false
    expect(releaseAffectedUses(base, next).uses).toEqual(['teammate'])
  })

  it('attributes identity to both customer and teammate uses', () => {
    const next = structuredClone(base)
    next.identity.name = 'Quill'
    expect(releaseAffectedUses(base, next).uses).toEqual(['customer', 'teammate'])
  })

  it('reports both uses when both moved, in a stable order', () => {
    const next = structuredClone(base)
    next.agents.copilot.capabilities.qa = false
    next.agents.agent.toolRules = { capture_feedback: 'always' } as never
    expect(releaseAffectedUses(base, next).uses).toEqual(['customer', 'teammate'])
  })

  it('bounds the changed-path list rather than growing without limit', () => {
    const next = structuredClone(base)
    const knowledge = next.agents.copilot.knowledge as Record<string, boolean>
    for (let i = 0; i < 100; i++) knowledge[`source${i}`] = true
    expect(releaseAffectedUses(base, next).changedPaths.length).toBeLessThanOrEqual(50)
  })
})

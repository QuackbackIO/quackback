/**
 * Runner semantics. The invariant under test throughout: nothing that failed to
 * execute is ever reported as a pass.
 */

import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig } from '../config'
import { exitCodeFor } from '../runner'
import { verifyCollisions } from '../fixtures'
import type { ProbeReport, WorkspaceHandle } from '../types'

function report(over: Partial<ProbeReport> = {}): ProbeReport {
  return {
    suite: 'quackback-workspace-isolation',
    schemaVersion: 1,
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    targets: { alpha: 'https://a.test', bravo: 'https://b.test' },
    capabilities: [],
    missingCapabilities: [],
    markers: {
      alpha: { slot: 'alpha', canary: 'a', ids: {} },
      bravo: { slot: 'bravo', canary: 'b', ids: {} },
    },
    verdict: 'PASS',
    partial: false,
    filteredOut: [],
    exitTolerates: [],
    counts: { PASS: 9, LEAK: 0, ERROR: 0, BLOCKED: 0 },
    tripwireHits: [],
    probes: [],
    ...over,
  }
}

describe('exitCodeFor', () => {
  it('returns 0 only when every probe passed', () => {
    expect(exitCodeFor(report())).toBe(0)
  })

  it('returns 2 for a cross-workspace observation, distinct from a harness failure', () => {
    expect(
      exitCodeFor(report({ verdict: 'FAIL', counts: { PASS: 8, LEAK: 1, ERROR: 0, BLOCKED: 0 } }))
    ).toBe(2)
  })

  it('returns 1 when a probe could not execute', () => {
    expect(
      exitCodeFor(report({ verdict: 'FAIL', counts: { PASS: 8, LEAK: 0, ERROR: 1, BLOCKED: 0 } }))
    ).toBe(1)
  })

  it('returns 1 for a blocked probe — a missing input is not a pass', () => {
    expect(
      exitCodeFor(report({ verdict: 'FAIL', counts: { PASS: 8, LEAK: 0, ERROR: 0, BLOCKED: 1 } }))
    ).toBe(1)
  })

  it('prefers the leak code when a run both leaked and errored', () => {
    expect(
      exitCodeFor(report({ verdict: 'FAIL', counts: { PASS: 6, LEAK: 1, ERROR: 2, BLOCKED: 0 } }))
    ).toBe(2)
  })
})

describe('parseConfig', () => {
  const env: Record<string, string | undefined> = {}

  it('accepts two distinct origins', () => {
    const config = parseConfig(
      ['--alpha', 'https://alpha.test', '--bravo', 'https://bravo.test'],
      env
    )
    expect(config.alphaUrl).toBe('https://alpha.test')
    expect(config.bravoUrl).toBe('https://bravo.test')
  })

  it('refuses to run with both slots pointed at one origin', () => {
    // A single workspace is trivially consistent with itself, so this
    // configuration would report perfect isolation while testing nothing.
    expect(() =>
      parseConfig(['--alpha', 'https://same.test', '--bravo', 'https://same.test/'], env)
    ).toThrow(ConfigError)
  })

  it('requires both targets', () => {
    expect(() => parseConfig(['--alpha', 'https://alpha.test'], env)).toThrow(/--bravo is required/)
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() =>
      parseConfig(['--alpha', 'https://a.test', '--bravo', 'https://b.test', '--allow-leaks'], env)
    ).toThrow(/unknown flag/)
  })

  it('falls back to environment variables', () => {
    const config = parseConfig([], {
      ALPHA_BASE_URL: 'https://alpha.test',
      BRAVO_BASE_URL: 'https://bravo.test',
      ALPHA_API_KEY: 'qb_alpha',
      BRAVO_API_KEY: 'qb_bravo',
    })
    expect(config.alphaApiKey).toBe('qb_alpha')
    expect(config.bravoApiKey).toBe('qb_bravo')
  })

  it('does not treat --allow-blocked as taking a value', () => {
    const config = parseConfig(
      ['--allow-blocked', '--alpha', 'https://a.test', '--bravo', 'https://b.test'],
      env
    )
    expect(config.allowBlocked).toBe(true)
    expect(config.alphaUrl).toBe('https://a.test')
  })
})

describe('verifyCollisions', () => {
  const handle = (slot: 'alpha' | 'bravo', over: Record<string, string> = {}): WorkspaceHandle => ({
    slot,
    baseUrl: `https://${slot}.test`,
    markers: { slot, canary: `canary-${slot}`, ids: { postId: `post-${slot}` } },
    http: null as never,
    fixture: {
      workspaceName: '',
      adminEmail: 'admin@example.com',
      adminUserId: `user-${slot}`,
      adminPrincipalId: '',
      boardId: `board-${slot}`,
      boardSlug: 'workspace-probe',
      boardTitle: 'Feature Requests',
      postId: `post-${slot}`,
      postTitle: 'Dark mode',
      postBody: '',
      ...over,
    },
  })

  it('accepts a fixture that collides on every human-readable field', () => {
    const result = verifyCollisions(handle('alpha'), handle('bravo'))
    expect(result.ok).toBe(true)
    expect(result.colliding).toEqual(
      expect.arrayContaining([expect.stringContaining('admin@example.com')])
    )
  })

  it('rejects a fixture whose titles do not collide — the probes would be trivial', () => {
    const result = verifyCollisions(handle('alpha'), handle('bravo', { postTitle: 'Light mode' }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('post title does not collide')
  })

  it('rejects identical ids across workspaces — that is one database, not two', () => {
    const result = verifyCollisions(handle('alpha'), handle('bravo', { postId: 'post-alpha' }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('same database')
  })
})

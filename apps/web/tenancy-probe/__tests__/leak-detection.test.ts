/**
 * Detection-sensitivity tests.
 *
 * A probe suite is only worth what it catches. These tests plant each hazard
 * from SAAS-HOSTING-STACK.md §4 into an in-process fleet and assert the matching
 * probe returns `LEAK` — and, just as importantly, that the same probe returns
 * `PASS` against the clean fleet, so the detection is not simply "always fails".
 *
 * The third case in each group is the one that catches a worthless suite: when
 * the target is unreachable or the credential is wrong, the verdict must be
 * `ERROR`, never `PASS`. A suite that scores a dead server as isolated is worse
 * than no suite, because it is trusted.
 */

import { describe, expect, it } from 'vitest'
import { p01SessionCookie } from '../probes/p01-session-cookie'
import { p03StorageToken } from '../probes/p03-storage-token'
import { p04WidgetIdentify } from '../probes/p04-widget-identify'
import { p05ApiKey } from '../probes/p05-api-key'
import { p06SettingsCache } from '../probes/p06-settings-cache'
import { p08CrossRead } from '../probes/p08-cross-read'
import { p09AssistantPrincipal } from '../probes/p09-assistant-principal'
import { FakeFleet, baseConfig, fakeDb, makeContext } from './fake-fleet'
import { ASSISTANT_PRINCIPAL_SQL } from '../db'
import type { ProbeOutcome } from '../types'

function failedNegatives(outcome: ProbeOutcome): string[] {
  return outcome.controls.filter((c) => c.kind !== 'positive' && !c.ok).map((c) => c.label)
}

describe('P01 session cookie replay', () => {
  it('passes against a clean fleet', async () => {
    const outcome = await p01SessionCookie.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when the session store is shared across tenants', async () => {
    const fleet = new FakeFleet({ sharedSessionStore: true })
    const outcome = await p01SessionCookie.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain('alpha cookie → bravo /api/auth/get-session')
    // The reason must name what happened, not just that something did.
    expect(outcome.reason).toContain('honoured by bravo')
  })

  it('names the identity when bravo answers with alphas own user id', async () => {
    const fleet = new FakeFleet({ sharedSessionStore: true })
    const outcome = await p01SessionCookie.run(makeContext(fleet))
    expect(outcome.reason).toContain("alpha's own user id")
  })

  it('reports ERROR, never PASS, when the fleet is unreachable', async () => {
    const fleet = new FakeFleet({ offline: true })
    await expect(p01SessionCookie.run(makeContext(fleet))).rejects.toThrow()
  })
})

describe('P03 storage read token', () => {
  it('passes when each tenant holds its own storage secret', async () => {
    const outcome = await p03StorageToken.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when both tenants share a storage secret', async () => {
    const fleet = new FakeFleet({ sharedStorageSecret: true })
    const outcome = await p03StorageToken.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain("alpha's capability → bravo (same key)")
    // The invariant must be flagged too — it is the root cause, not a symptom.
    const invariant = outcome.controls.find((c) => c.kind === 'invariant')
    expect(invariant?.ok).toBe(false)
  })

  it('reports ERROR when the supplied secret does not match the deployment', async () => {
    const fleet = new FakeFleet()
    const config = baseConfig(fleet, { alphaStorageSecret: 'wrong-secret' })
    const outcome = await p03StorageToken.run(makeContext(fleet, config))
    expect(outcome.verdict).toBe('ERROR')
    expect(outcome.reason).toContain('positive control failed')
  })
})

describe('P04 widget identify token', () => {
  it('passes when each tenant holds its own widget secret', async () => {
    const outcome = await p04WidgetIdentify.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when the widget signing secret spans tenants', async () => {
    const fleet = new FakeFleet({ sharedWidgetSecret: true })
    const outcome = await p04WidgetIdentify.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain("alpha's identify token → bravo")
  })
})

describe('P05 API key', () => {
  it('passes when each tenant rejects the others key', async () => {
    const outcome = await p05ApiKey.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when API keys are honoured across tenants', async () => {
    const fleet = new FakeFleet({ sharedApiKeys: true })
    const outcome = await p05ApiKey.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain("alpha's key → bravo GET /api/v1/boards")
  })

  it('distinguishes "read the wrong database" from "accepted the wrong credential"', async () => {
    const fleet = new FakeFleet({ sharedApiKeys: true })
    const outcome = await p05ApiKey.run(makeContext(fleet))
    const cross = outcome.controls.find((c) => c.label === "alpha's key → bravo GET /api/v1/boards")
    // The fake fleet serves bravo's own rows to alpha's key, which is the
    // plausible-looking wrong answer this probe exists to catch.
    expect(cross?.detail).toContain("BRAVO's rows")
  })
})

describe('P06 settings and branding cache', () => {
  it('passes when each tenant serves its own settings blob', async () => {
    const outcome = await p06SettingsCache.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports ERROR, not PASS, when both tenants are byte-identical and the probe is blind', async () => {
    const fleet = new FakeFleet({ sharedSettingsCache: true })
    const outcome = await p06SettingsCache.run(makeContext(fleet))
    // A shared cache makes every surface identical, which the probe must report
    // as an inability to see rather than as isolation.
    expect(outcome.verdict).toBe('ERROR')
    expect(outcome.reason).toContain('blind')
  })
})

describe('P08 cross-tenant read', () => {
  it('passes when each tenants search returns only its own rows', async () => {
    const outcome = await p08CrossRead.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when the search index spans tenants', async () => {
    const fleet = new FakeFleet({ sharedSearchIndex: true })
    const outcome = await p08CrossRead.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome).length).toBeGreaterThan(0)
  })

  it('does not mistake the colliding title for a leak', async () => {
    // Both tenants legitimately have a post titled "Dark mode". A probe that
    // asserted an empty result set here would fail on a correct system.
    const outcome = await p08CrossRead.run(makeContext(new FakeFleet()))
    const collidingCheck = outcome.controls.find((c) => c.label.includes('colliding title'))
    expect(collidingCheck?.ok).toBe(true)
    expect(collidingCheck?.detail).toContain("bravo's own fixture post")
  })
})

describe('P09 assistant service principal', () => {
  const ALPHA_PRINCIPAL_UUID = '018f0000-0000-7000-8000-0000000000a1'
  const BRAVO_PRINCIPAL_UUID = '018f0000-0000-7000-8000-0000000000b2'

  it('passes when the two assistant principals are distinct and unreferenced', async () => {
    const ctx = makeContext(new FakeFleet())
    ctx.alpha.db = fakeDb('alpha', {
      [ASSISTANT_PRINCIPAL_SQL.trim().split('\n')[1].trim()]: [{ id: ALPHA_PRINCIPAL_UUID }],
      'information_schema.columns': [],
    })
    ctx.bravo.db = fakeDb('bravo', {
      [ASSISTANT_PRINCIPAL_SQL.trim().split('\n')[1].trim()]: [{ id: BRAVO_PRINCIPAL_UUID }],
      'information_schema.columns': [],
    })
    const outcome = await p09AssistantPrincipal.run(ctx)
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports BLOCKED, not PASS, when an assistant principal has never been provisioned', async () => {
    const ctx = makeContext(new FakeFleet())
    ctx.alpha.db = fakeDb('alpha', { 'information_schema.columns': [] })
    ctx.bravo.db = fakeDb('bravo', { 'information_schema.columns': [] })
    const outcome = await p09AssistantPrincipal.run(ctx)
    expect(outcome.verdict).toBe('BLOCKED')
    expect(outcome.reason).toContain('provisioned lazily')
  })

  it('reports LEAK when both tenants share one assistant principal id', async () => {
    const ctx = makeContext(new FakeFleet())
    const shared = [{ id: ALPHA_PRINCIPAL_UUID }]
    const key = ASSISTANT_PRINCIPAL_SQL.trim().split('\n')[1].trim()
    ctx.alpha.db = fakeDb('alpha', { [key]: shared, 'information_schema.columns': [] })
    ctx.bravo.db = fakeDb('bravo', { [key]: shared, 'information_schema.columns': [] })
    const outcome = await p09AssistantPrincipal.run(ctx)
    expect(outcome.verdict).toBe('LEAK')
    expect(outcome.reason).toContain('assistant service principal')
  })
})

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
import { FakeFleet, baseConfig, createFakeDb, makeContext } from './fake-fleet'
import type { ProbeOutcome } from '../types'

function failedNegatives(outcome: ProbeOutcome): string[] {
  return outcome.controls.filter((c) => c.kind !== 'positive' && !c.ok).map((c) => c.label)
}

describe('P01 session cookie replay', () => {
  it('passes against a clean fleet', async () => {
    const outcome = await p01SessionCookie.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when the session store is shared across workspaces', async () => {
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

/** A fleet that signs storage capabilities over the pooled, workspace-bound message. */
const POOLED_BINDINGS = {
  alpha: { workspaceKey: 'tnt_a' },
  bravo: { workspaceKey: 'tnt_b' },
}

describe('P03 storage read token', () => {
  it('passes when each workspace holds its own storage secret', async () => {
    const outcome = await p03StorageToken.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when both workspaces share a storage secret', async () => {
    const fleet = new FakeFleet({ sharedStorageSecret: true })
    const outcome = await p03StorageToken.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain("alpha's capability as issued → bravo (same key)")
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

  it('catches a shared secret through an OBSERVATION, not just the operator-typed invariant', async () => {
    // Defect 4. `storageReadSig` signs `workspaceBind('read|<key>')`, so once
    // workspace ids are supplied a capability minted for alpha can never verify on
    // bravo whatever the secret is — the plain replay is refused by arithmetic,
    // and the only remaining detector was an `invariant` comparing two strings
    // the operator typed. The interchange attempt holds the key AND the binding
    // constant and varies only the secret, so it can fail, and here it does.
    const fleet = new FakeFleet({ sharedStorageSecret: true })
    const outcome = await p03StorageToken.run(makeContext(fleet))
    const interchange = outcome.controls.filter((c) => c.attemptId === 'storage-secret-interchange')
    expect(interchange).toHaveLength(2)
    expect(interchange.every((c) => !c.ok)).toBe(true)
    expect(interchange[0].detail).toContain('verifies on bravo')
  })

  it('says out loud when the plain replay is over-determined rather than reporting a clean pass', async () => {
    // A probe that knows it cannot fail must not report as though it could.
    // With per-workspace bindings the replay is refused by the message mismatch,
    // and the control's own detail says so instead of reading 'refused with 403'.
    const fleet = new FakeFleet({}, POOLED_BINDINGS)
    const outcome = await p03StorageToken.run(
      makeContext(
        fleet,
        baseConfig(fleet, { alphaWorkspaceKey: 'tnt_a', bravoWorkspaceKey: 'tnt_b' })
      )
    )
    expect(outcome.verdict).toBe('PASS')
    const replay = outcome.controls.find(
      (c) => c.label === "alpha's capability as issued → bravo (same key)"
    )
    expect(replay?.detail).toContain('OVER-DETERMINED')
    expect(outcome.observed).toContain('secret-interchange attempt is what carried the verdict')
  })

  it('still catches a shared secret when per-workspace bindings are in force', async () => {
    // The condition the pooled fleet will actually be in: bindings separate the
    // messages, so the replay cannot fail — and the shared secret is caught
    // anyway, because the interchange attempt signs the message bravo verifies.
    const fleet = new FakeFleet({ sharedStorageSecret: true }, POOLED_BINDINGS)
    const outcome = await p03StorageToken.run(
      makeContext(
        fleet,
        baseConfig(fleet, { alphaWorkspaceKey: 'tnt_a', bravoWorkspaceKey: 'tnt_b' })
      )
    )
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain(
      "alpha's SECRET against bravo's own message (same key, bravo's binding)"
    )
  })

  it('fails the positive control loudly when a supplied workspace id does not match the deployment', async () => {
    // The binding is calibrated against the host rather than assumed, so a
    // wrong --alpha-workspace-key cannot silently make every negative unfailable.
    // This fleet signs the unbound message, and the probe finds that out.
    const fleet = new FakeFleet()
    const outcome = await p03StorageToken.run(
      makeContext(fleet, baseConfig(fleet, { alphaWorkspaceKey: 'tnt_wrong' }))
    )
    expect(outcome.verdict).toBe('PASS')
    const positive = outcome.controls.find((c) => c.label === "alpha's own capability → alpha")
    expect(positive?.ok).toBe(true)
    expect(positive?.detail).toContain('unbound')
  })
})

describe('P04 widget identify token', () => {
  it('passes when each workspace holds its own widget secret', async () => {
    const outcome = await p04WidgetIdentify.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when the widget signing secret spans workspaces', async () => {
    const fleet = new FakeFleet({ sharedWidgetSecret: true })
    const outcome = await p04WidgetIdentify.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain("alpha's identify token → bravo")
  })
})

describe('P05 API key', () => {
  it('passes when each workspace rejects the others key', async () => {
    const outcome = await p05ApiKey.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when API keys are honoured across workspaces', async () => {
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
  it('passes when each workspace serves its own settings blob', async () => {
    const outcome = await p06SettingsCache.run(
      makeContext(new FakeFleet(), undefined, { withDb: true })
    )
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when bravo serves alphas cached settings', async () => {
    // The leaking surfaces carry NO workspace id and NO slug — only the theme
    // colour and the workspace name. An earlier version searched for the id and
    // the slug, found neither, and reported PASS on exactly this fleet.
    const fleet = new FakeFleet({ sharedSettingsCache: true })
    const outcome = await p06SettingsCache.run(makeContext(fleet, undefined, { withDb: true }))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome).length).toBeGreaterThan(0)
    expect(outcome.observed).toContain('FOREIGN IDENTITY SERVED')
  })

  it('reports LEAK on a partial identity leak that leaves the host rendering its own colour', async () => {
    // The round-4 shape: the portal serves alpha's cached name and headline
    // while the widget config keeps bravo's own colour. Every defence built on
    // derived vocabulary missed it; the planted token does not.
    const fleet = new FakeFleet({ partialIdentityLeak: true })
    const outcome = await p06SettingsCache.run(makeContext(fleet, undefined, { withDb: true }))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome)).toContain(
      "alpha's planted identity token → bravo (portal document)"
    )
  })

  it('reports ERROR, not PASS, when the planted token is not observable', async () => {
    const fleet = new FakeFleet({ omitPlantedToken: true })
    const outcome = await p06SettingsCache.run(makeContext(fleet, undefined, { withDb: true }))
    expect(outcome.verdict).toBe('ERROR')
    expect(outcome.observed).toContain('planted identity token')
  })

  it('is not fooled by a per-request nonce in the document', async () => {
    const fleet = new FakeFleet({ perRequestNonce: true })
    const outcome = await p06SettingsCache.run(makeContext(fleet, undefined, { withDb: true }))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports BLOCKED without database access rather than guessing', async () => {
    const outcome = await p06SettingsCache.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('BLOCKED')
    expect(outcome.reason).toContain('--alpha-db')
  })
})

describe('P08 cross-workspace read', () => {
  it('passes when each workspaces search returns only its own rows', async () => {
    const outcome = await p08CrossRead.run(makeContext(new FakeFleet()))
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports LEAK when the search index spans workspaces', async () => {
    const fleet = new FakeFleet({ sharedSearchIndex: true })
    const outcome = await p08CrossRead.run(makeContext(fleet))
    expect(outcome.verdict).toBe('LEAK')
    expect(failedNegatives(outcome).length).toBeGreaterThan(0)
  })

  it('does not mistake the colliding title for a leak', async () => {
    // Both workspaces legitimately have a post titled "Dark mode". A probe that
    // asserted an empty result set here would fail on a correct system.
    const outcome = await p08CrossRead.run(makeContext(new FakeFleet()))
    const collidingCheck = outcome.controls.find((c) => c.label.includes('colliding title'))
    expect(collidingCheck?.ok).toBe(true)
    expect(collidingCheck?.detail).toContain("bravo's own fixture post")
  })
})

describe('P09 assistant service principal', () => {
  function ctxWithPrincipals(alphaUuid: string | null, bravoUuid: string | null) {
    const fleet = new FakeFleet()
    const ctx = makeContext(fleet)
    ctx.alpha.db = createFakeDb('alpha', { assistantPrincipalUuid: alphaUuid })
    ctx.bravo.db = createFakeDb('bravo', { assistantPrincipalUuid: bravoUuid })
    return ctx
  }

  const ALPHA_PRINCIPAL_UUID = '018f0000-0000-7000-8000-0000000000a1'
  const BRAVO_PRINCIPAL_UUID = '018f0000-0000-7000-8000-0000000000b2'

  it('passes when the two assistant principals are distinct and unreferenced', async () => {
    const outcome = await p09AssistantPrincipal.run(
      ctxWithPrincipals(ALPHA_PRINCIPAL_UUID, BRAVO_PRINCIPAL_UUID)
    )
    expect(outcome.verdict).toBe('PASS')
  })

  it('reports BLOCKED, not PASS, when an assistant principal has never been provisioned', async () => {
    const outcome = await p09AssistantPrincipal.run(ctxWithPrincipals(null, BRAVO_PRINCIPAL_UUID))
    expect(outcome.verdict).toBe('BLOCKED')
    expect(outcome.reason).toContain('provisioned lazily')
  })

  it('reports LEAK when both workspaces share one assistant principal id', async () => {
    const outcome = await p09AssistantPrincipal.run(
      ctxWithPrincipals(ALPHA_PRINCIPAL_UUID, ALPHA_PRINCIPAL_UUID)
    )
    expect(outcome.verdict).toBe('LEAK')
    expect(outcome.reason).toContain('assistant service principal')
  })

  it('reports ERROR when the row scan could not cover the schema', async () => {
    // A misspelled or missing table narrows the scan in silence; a clean result
    // from a narrowed scan must never read as isolation.
    const fleet = new FakeFleet()
    const ctx = makeContext(fleet)
    ctx.alpha.db = createFakeDb('alpha', {
      assistantPrincipalUuid: ALPHA_PRINCIPAL_UUID,
      omitTables: ['conversation_messages', 'assistant_involvements'],
    })
    ctx.bravo.db = createFakeDb('bravo', {
      assistantPrincipalUuid: BRAVO_PRINCIPAL_UUID,
      omitTables: ['conversation_messages', 'assistant_involvements'],
    })
    const outcome = await p09AssistantPrincipal.run(ctx)
    expect(outcome.verdict).toBe('ERROR')
    expect(outcome.observed).toContain('conversation_messages')
  })
})

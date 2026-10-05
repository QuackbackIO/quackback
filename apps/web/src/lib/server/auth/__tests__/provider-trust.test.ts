import { describe, it, expect, beforeEach } from 'vitest'
import {
  allowsAutoLinking,
  oidcTrustedProviderIds,
  resetTrustObservations,
  type ObservedProviderRow,
} from '../provider-trust'

function recordingLog() {
  const lines: Array<{ ctx: Record<string, unknown>; msg: string }> = []
  return { lines, info: (ctx: Record<string, unknown>, msg: string) => lines.push({ ctx, msg }) }
}

// Rows as an upgraded install has them: carried forward with no connection
// test (the portal provider never had one), or tested before a later change.
const untestedSso: ObservedProviderRow = {
  id: 'idp-sso',
  registrationId: 'sso',
  lastSuccessfulTestAt: null,
  detailsChangedAt: null,
}
const stalePortal: ObservedProviderRow = {
  id: 'idp-portal',
  registrationId: 'custom-oidc',
  lastSuccessfulTestAt: '2026-07-01T00:00:00Z',
  detailsChangedAt: '2026-07-02T00:00:00Z',
}
const tested: ObservedProviderRow = {
  id: 'idp-tested',
  registrationId: 'oidc_tested',
  lastSuccessfulTestAt: '2026-07-03T00:00:00Z',
  detailsChangedAt: '2026-07-02T00:00:00Z',
}
const rows = [untestedSso, stalePortal, tested]

describe('oidcTrustedProviderIds', () => {
  beforeEach(() => resetTrustObservations())

  it('trusts every registered provider for auto-linking, tested or not', () => {
    // Existing password and magic-link users link on their first SSO sign-in
    // through this list. Dropping an untested provider would turn that into
    // "account not linked" on upgrade with no admin action.
    const ids = oidcTrustedProviderIds(['sso', 'custom-oidc', 'oidc_tested'], rows, recordingLog())
    expect(ids).toEqual(['sso', 'custom-oidc', 'oidc_tested'])
  })

  it('reports untested and stale providers at info level with the action to take', () => {
    const log = recordingLog()
    oidcTrustedProviderIds(['sso', 'custom-oidc', 'oidc_tested'], rows, log)
    expect(log.lines.map((l) => l.ctx)).toEqual([
      { registrationId: 'sso', identityProviderId: 'idp-sso', testState: 'untested' },
      { registrationId: 'custom-oidc', identityProviderId: 'idp-portal', testState: 'stale' },
    ])
    for (const { msg } of log.lines) {
      expect(msg).toContain('unaffected')
      expect(msg).toContain('Run the connection test')
      expect(msg).not.toContain('would lose')
    }
  })

  it('reports a provider once per test state across auth rebuilds', () => {
    const log = recordingLog()
    oidcTrustedProviderIds(['sso'], rows, log)
    oidcTrustedProviderIds(['sso'], rows, log)
    expect(log.lines).toHaveLength(1)

    // A new state (here a later details change) is worth one more line.
    oidcTrustedProviderIds(
      ['sso'],
      [{ ...untestedSso, detailsChangedAt: '2026-07-04T00:00:00Z' }],
      log
    )
    expect(log.lines).toHaveLength(2)
  })

  it('keeps one state per provider, so returning to an earlier state reports again', () => {
    // Only the latest state per row is remembered, which bounds the memory by
    // provider count rather than by every state a provider has ever been in.
    const log = recordingLog()
    const changed = { ...untestedSso, detailsChangedAt: '2026-07-04T00:00:00Z' }
    oidcTrustedProviderIds(['sso'], [untestedSso], log)
    oidcTrustedProviderIds(['sso'], [changed], log)
    oidcTrustedProviderIds(['sso'], [untestedSso], log)
    expect(log.lines).toHaveLength(3)
  })

  it('forgets a provider once it is trusted', () => {
    const log = recordingLog()
    const passed = { ...stalePortal, lastSuccessfulTestAt: '2026-07-03T00:00:00Z' }
    oidcTrustedProviderIds(['custom-oidc'], [stalePortal], log)
    oidcTrustedProviderIds(['custom-oidc'], [passed], log)
    oidcTrustedProviderIds(['custom-oidc'], [stalePortal], log)
    expect(log.lines).toHaveLength(2)
  })

  it('does not report a provider whose test postdates its last change', () => {
    const log = recordingLog()
    oidcTrustedProviderIds(['oidc_tested'], rows, log)
    expect(log.lines).toEqual([])
  })
})

const verifiedTier = {
  lastSuccessfulTestAt: '2026-07-01T00:00:00Z',
  detailsChangedAt: null,
  assertsVerifiedEmail: true,
  trustOverride: null,
}

describe('allowsAutoLinking', () => {
  it('permits a provider that passed its test and asserts a verified address', () => {
    expect(allowsAutoLinking(verifiedTier)).toBe(true)
  })

  it('refuses a provider that has never passed its connection test', () => {
    // Auto-linking attaches an incoming identity to an EXISTING local account
    // on address match alone. A provider that has not proved it resolves an
    // identity correctly has not earned that.
    expect(allowsAutoLinking({ ...verifiedTier, lastSuccessfulTestAt: null })).toBe(false)
  })

  it('refuses a provider whose test is stale', () => {
    // Config changed after the last pass, so the pass vouches for a
    // configuration that is no longer in effect.
    expect(allowsAutoLinking({ ...verifiedTier, detailsChangedAt: '2026-07-02T00:00:00Z' })).toBe(
      false
    )
  })

  it('refuses a provider that does not assert a verified address', () => {
    // This is what separates a corporate IdP, where the workspace controls who
    // can hold an identity, from a public one where anyone in the world can
    // register the address of someone who already has a local account.
    expect(allowsAutoLinking({ ...verifiedTier, assertsVerifiedEmail: false })).toBe(false)
  })

  it('honours an explicit admin override in both directions', () => {
    // Some IdPs under-report; an admin who knows better can force it on, and
    // one who wants it off can force that too.
    expect(
      allowsAutoLinking({ ...verifiedTier, assertsVerifiedEmail: false, trustOverride: true })
    ).toBe(true)
    expect(allowsAutoLinking({ ...verifiedTier, trustOverride: false })).toBe(false)
  })

  it('treats a test at exactly the change time as stale', () => {
    expect(
      allowsAutoLinking({
        ...verifiedTier,
        lastSuccessfulTestAt: '2026-07-01T00:00:00Z',
        detailsChangedAt: '2026-07-01T00:00:00Z',
      })
    ).toBe(false)
  })
})

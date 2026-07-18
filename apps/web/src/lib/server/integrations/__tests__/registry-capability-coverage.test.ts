/**
 * Registry ↔ out-of-registry-switch drift gate. Two provider capabilities
 * still live in hand-maintained switch statements outside the
 * IntegrationDefinition contract — webhook auto-registration
 * (functions/status-sync.ts) and external status lists
 * (functions/external-statuses.ts) — and both silently no-op for a provider
 * missing a case. This suite pins their declared coverage sets against the
 * registry so adding an inbound-capable provider without deciding its
 * webhook-setup and status-list story is a CI failure, not a silent gap.
 * (The real fix — folding both into IntegrationDefinition — is a named
 * follow-up; this is the stopgap that stops the rot.)
 */
import { describe, it, expect } from 'vitest'
import { getIntegration, listIntegrationTypes } from '../index'
import {
  AUTO_WEBHOOK_REGISTRATION_PROVIDERS,
  MANUAL_WEBHOOK_PROVIDERS,
} from '@/lib/server/functions/status-sync'
import { EXTERNAL_STATUS_PROVIDERS } from '@/lib/server/functions/external-statuses'

/** Inbound-capable providers whose config UI ships no status-mapping surface
 *  yet — a real, documented gap (their configs never mount StatusSyncConfig).
 *  Closing one means removing it here AND adding its statuses case + UI. */
const KNOWN_STATUS_LIST_GAPS = new Set(['gitlab', 'trello'])

const inboundProviders = listIntegrationTypes().filter((t) => getIntegration(t)?.inbound)

describe('registry capability coverage', () => {
  it('has inbound providers to check (guard against a silently empty registry)', () => {
    expect(inboundProviders.length).toBeGreaterThanOrEqual(9)
  })

  it('every inbound provider has a declared webhook-setup story (auto XOR manual)', () => {
    for (const type of inboundProviders) {
      const auto = AUTO_WEBHOOK_REGISTRATION_PROVIDERS.has(type)
      const manual = MANUAL_WEBHOOK_PROVIDERS.has(type)
      expect(
        auto || manual,
        `${type} has inbound but no declared webhook-setup story — add it to ` +
          `AUTO_WEBHOOK_REGISTRATION_PROVIDERS (and the switch cases) or MANUAL_WEBHOOK_PROVIDERS`
      ).toBe(true)
      expect(auto && manual, `${type} is declared both auto and manual`).toBe(false)
    }
  })

  it('the webhook-setup sets contain no provider the registry lacks inbound for', () => {
    for (const type of [...AUTO_WEBHOOK_REGISTRATION_PROVIDERS, ...MANUAL_WEBHOOK_PROVIDERS]) {
      expect(
        getIntegration(type)?.inbound,
        `${type} is declared in a webhook-setup set but has no inbound handler`
      ).toBeTruthy()
    }
  })

  it('every inbound provider has an external-status source or a documented gap', () => {
    for (const type of inboundProviders) {
      expect(
        EXTERNAL_STATUS_PROVIDERS.has(type) || KNOWN_STATUS_LIST_GAPS.has(type),
        `${type} has inbound but no external-status source — add a case in ` +
          `external-statuses.ts (and EXTERNAL_STATUS_PROVIDERS) or document the gap here`
      ).toBe(true)
    }
  })

  it('documented status-list gaps stay gaps (stale exemptions must be removed)', () => {
    for (const type of KNOWN_STATUS_LIST_GAPS) {
      expect(
        EXTERNAL_STATUS_PROVIDERS.has(type),
        `${type} now has a status source — remove it from KNOWN_STATUS_LIST_GAPS`
      ).toBe(false)
    }
  })

  it('issue capabilities keep their inbound-namespace contract', () => {
    // A provider offering parseRef must have inbound (the parsed externalId
    // exists to serve inbound reverse lookup); create-only providers (e.g.
    // Monday/Notion, if ever) are fine without.
    for (const type of listIntegrationTypes()) {
      const def = getIntegration(type)
      if (def?.issues?.parseRef) {
        expect(def.inbound, `${type} has issues.parseRef but no inbound handler`).toBeTruthy()
      }
    }
  })
})

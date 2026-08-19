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

const inboundProviders = listIntegrationTypes().filter((t) => getIntegration(t)?.inbound)

// Webhook-setup split, derived from the registry (the server-fn bridges must
// not export these — a module-level registry read there poisons the client
// bundle via import-protection; see status-sync.ts / external-statuses.ts).
const AUTO_WEBHOOK_REGISTRATION_PROVIDERS = new Set(
  listIntegrationTypes().filter((t) => typeof getIntegration(t)?.webhookRegistration === 'object')
)
const MANUAL_WEBHOOK_PROVIDERS = new Set(
  listIntegrationTypes().filter((t) => getIntegration(t)?.webhookRegistration === 'manual')
)
const EXTERNAL_STATUS_PROVIDERS = new Set(
  listIntegrationTypes().filter((t) => getIntegration(t)?.listExternalStatuses)
)

describe('registry capability coverage', () => {
  it('has inbound providers to check (guard against a silently empty registry)', () => {
    expect(inboundProviders.length).toBeGreaterThanOrEqual(9)
  })

  it('every inbound provider declares webhookRegistration (WO-2: setup story lives in the registry)', () => {
    for (const type of inboundProviders) {
      const registration = getIntegration(type)?.webhookRegistration
      expect(
        registration,
        `${type} has inbound but no webhookRegistration — declare 'manual' or { register, unregister }`
      ).toBeTruthy()
    }
  })

  it('webhookRegistration is declared only by inbound providers', () => {
    for (const type of listIntegrationTypes()) {
      if (getIntegration(type)?.webhookRegistration) {
        expect(
          getIntegration(type)?.inbound,
          `${type} declares webhookRegistration but has no inbound handler`
        ).toBeTruthy()
      }
    }
  })

  it('the derived auto/manual sets match the expected split', () => {
    // The exact split that lived in status-sync.ts's hand-maintained sets.
    expect([...AUTO_WEBHOOK_REGISTRATION_PROVIDERS].sort()).toEqual(
      ['asana', 'clickup', 'github', 'jira', 'linear'].sort()
    )
    expect([...MANUAL_WEBHOOK_PROVIDERS].sort()).toEqual(
      ['azure_devops', 'gitlab', 'shortcut', 'trello'].sort()
    )
  })

  it('every inbound provider declares listExternalStatuses (WO-3: no more gap list)', () => {
    for (const type of inboundProviders) {
      expect(
        getIntegration(type)?.listExternalStatuses,
        `${type} has inbound but no listExternalStatuses — the mapping UI would be empty`
      ).toBeTypeOf('function')
    }
    // Derived set matches: exactly the inbound providers have a status source.
    expect([...EXTERNAL_STATUS_PROVIDERS].sort()).toEqual([...inboundProviders].sort())
  })

  it('every tracker provider declares archive (WO-1: archive dispatch lives in the registry)', () => {
    // The exact set that lived in archive.ts's hand-keyed archiveFns table.
    const ARCHIVE_PROVIDERS = new Set([
      'linear',
      'github',
      'jira',
      'gitlab',
      'clickup',
      'asana',
      'shortcut',
      'azure_devops',
      'trello',
      'notion',
      'monday',
    ])
    for (const type of ARCHIVE_PROVIDERS) {
      expect(
        getIntegration(type)?.archive,
        `${type} must declare .archive (close/archive the linked item on post delete)`
      ).toBeTypeOf('function')
    }
    for (const type of listIntegrationTypes()) {
      if (getIntegration(type)?.archive) {
        expect(
          ARCHIVE_PROVIDERS.has(type),
          `${type} declares .archive — add it to ARCHIVE_PROVIDERS so the set stays exact`
        ).toBe(true)
      }
    }
  })

  it('every tracker provider declares destinations (WO-7: routing targets live in the registry)', () => {
    // The 11 trackers that can receive created work — same set as archive.
    const TRACKER_PROVIDERS = [
      'linear',
      'github',
      'jira',
      'gitlab',
      'clickup',
      'asana',
      'shortcut',
      'azure_devops',
      'trello',
      'notion',
      'monday',
    ]
    // Providers whose destinations include a dependent (parent → child) kind.
    const TWO_LEVEL = new Set(['trello', 'jira', 'clickup', 'azure_devops'])

    for (const type of TRACKER_PROVIDERS) {
      const destinations = getIntegration(type)?.destinations
      expect(destinations, `${type} must declare destinations`).toBeTruthy()
      const kinds = Object.entries(destinations ?? {})
      expect(kinds.length, `${type} destinations must have at least one kind`).toBeGreaterThan(0)
      for (const [kind, dest] of kinds) {
        expect(dest.list, `${type}.${kind}.list`).toBeTypeOf('function')
        expect(dest.label, `${type}.${kind}.label`).toBeTruthy()
        // A childOf must name a sibling kind on the same provider.
        if (dest.childOf) {
          expect(
            destinations![dest.childOf],
            `${type}.${kind}.childOf='${dest.childOf}' must be a declared kind`
          ).toBeTruthy()
        }
      }
      const hasDependent = kinds.some(([, d]) => d.childOf)
      expect(
        hasDependent,
        `${type} ${TWO_LEVEL.has(type) ? 'must' : 'must not'} have a dependent (childOf) kind`
      ).toBe(TWO_LEVEL.has(type))
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

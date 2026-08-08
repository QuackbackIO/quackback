/**
 * The seat classification rule, in isolation from the query that feeds it.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import { classifySeat } from '../seats'
import { checkoutLineItems, desiredQuantities } from '../seat-sync'
import { READ_ONLY_PERMISSIONS } from '../permission-classes'
import type { BillingConfig } from '../billing.config'

function set(keys: readonly PermissionKey[]): ReadonlySet<PermissionKey> {
  return new Set(keys)
}

describe('classifySeat', () => {
  it('classes a teammate with no permissions at all as lite', () => {
    expect(classifySeat(set([]))).toEqual({ lite: true, copilot: false })
  })

  it('classes a purely read-only grant as lite', () => {
    expect(classifySeat(set(READ_ONLY_PERMISSIONS))).toEqual({ lite: true, copilot: false })
  })

  it('classes one write permission among many reads as full', () => {
    const keys = [...READ_ONLY_PERMISSIONS, PERMISSIONS.CONVERSATION_REPLY]
    expect(classifySeat(set(keys))).toEqual({ lite: false, copilot: false })
  })

  it('flags Copilot access independently of the seat class', () => {
    expect(classifySeat(set([PERMISSIONS.COPILOT_USE]))).toEqual({ lite: false, copilot: true })
    expect(classifySeat(set([PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COPILOT_USE]))).toEqual({
      lite: false,
      copilot: true,
    })
  })

  it('classes every system role preset as a full seat', () => {
    // The load-bearing consequence of the derivation: none of the four
    // shipped presets is read-only, so no existing install accidentally
    // reclassifies its team as lite the day billing is switched on.
    for (const [role, keys] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
      expect({ role, ...classifySeat(set(keys)) }).toEqual({
        role,
        lite: false,
        copilot: expect.any(Boolean),
      })
    }
  })

  it('classes both legacy role fallbacks as full seats', () => {
    // A principal with no custom role assignment resolves through the legacy
    // preset. Both of those carry write permissions, so a workspace that has
    // never used custom roles bills every teammate at the full rate.
    expect(classifySeat(permissionsForLegacyRole('admin')).lite).toBe(false)
    expect(classifySeat(permissionsForLegacyRole('member')).lite).toBe(false)
  })
})

describe('desiredQuantities', () => {
  it('maps counts onto meters', () => {
    expect(desiredQuantities({ full: 3, lite: 5, copilot: 2, total: 8 })).toEqual({
      fullSeat: 3,
      liteSeat: 5,
      copilotSeat: 2,
    })
  })
})

describe('checkoutLineItems', () => {
  const config = {
    catalogue: {
      pro: {
        seat: 'price_seat',
        liteSeat: 'price_lite',
        copilotSeat: 'price_copilot',
        outcome: 'price_outcome',
        outcomeMeter: 'meter',
      },
      free: { seat: 'price_free_seat' },
    },
  } as unknown as BillingConfig

  it('builds one line per sold meter', () => {
    expect(checkoutLineItems(config, 'pro', { full: 2, lite: 1, copilot: 1, total: 3 })).toEqual([
      { price: 'price_seat', quantity: 2 },
      { price: 'price_lite', quantity: 1 },
      { price: 'price_copilot', quantity: 1 },
      // A metered line must carry no quantity; the provider rejects the
      // session outright if it does, so the absence of the key is the assertion.
      { price: 'price_outcome' },
    ])
  })

  it('omits meters with a zero count', () => {
    expect(checkoutLineItems(config, 'pro', { full: 3, lite: 0, copilot: 0, total: 3 })).toEqual([
      { price: 'price_seat', quantity: 3 },
      { price: 'price_outcome' },
    ])
  })

  it('never sends a zero quantity on the seat line', () => {
    // A subscription whose only licensed item has quantity 0 is rejected.
    expect(checkoutLineItems(config, 'free', { full: 0, lite: 0, copilot: 0, total: 0 })).toEqual([
      { price: 'price_free_seat', quantity: 1 },
    ])
  })

  it('returns nothing for a plan the deployment does not sell', () => {
    expect(checkoutLineItems(config, 'enterprise', { full: 1, lite: 0, copilot: 0, total: 1 })).toEqual(
      []
    )
  })
})

/**
 * The seat classification rule, in isolation from the query that feeds it.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import { classifySeat, type SeatCounts } from '../seats'
import { checkoutLineItems, desiredQuantities } from '../seat-sync'
import { SUPPORT_READ_PERMISSIONS } from '../permission-classes'
import type { BillingConfig } from '../billing.config'

function set(keys: readonly PermissionKey[]): ReadonlySet<PermissionKey> {
  return new Set(keys)
}

describe('classifySeat', () => {
  it('classes a teammate with no permissions at all as lite', () => {
    expect(classifySeat(set([]))).toEqual({ lite: true, copilotEligible: false })
  })

  it('classes a support-read-only grant as lite', () => {
    expect(classifySeat(set(SUPPORT_READ_PERMISSIONS))).toEqual({
      lite: true,
      copilotEligible: false,
    })
  })

  it('classes a product manager who writes everywhere BUT support as lite', () => {
    // The operator's rule is "read-only on the customer support side", not
    // "read-only". This case is the whole difference between the chosen
    // reading and the competing one, and it decides money — so it is asserted
    // directly rather than left to follow from the lists.
    const productManager = [
      PERMISSIONS.POST_CREATE,
      PERMISSIONS.POST_EDIT,
      PERMISSIONS.POST_SET_STATUS,
      PERMISSIONS.BOARD_MANAGE,
      PERMISSIONS.ROADMAP_MANAGE,
      PERMISSIONS.CHANGELOG_MANAGE,
      PERMISSIONS.STATUS_PAGE_PUBLISH,
      PERMISSIONS.ANALYTICS_VIEW,
      // Sees the inbox, cannot act in it.
      PERMISSIONS.CONVERSATION_VIEW,
      PERMISSIONS.CONVERSATION_VIEW_ALL,
      PERMISSIONS.TICKET_VIEW,
    ]
    expect(classifySeat(set(productManager))).toEqual({ lite: true, copilotEligible: false })
  })

  it('classes one support write among many reads as full', () => {
    const keys = [...SUPPORT_READ_PERMISSIONS, PERMISSIONS.CONVERSATION_REPLY]
    expect(classifySeat(set(keys))).toEqual({ lite: false, copilotEligible: false })
  })

  it('classes a support operations manager as full even without replying', () => {
    // Never touches a conversation directly, decides what happens to all of
    // them. Full by the documented borderline rule.
    expect(classifySeat(set([PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.SLA_MANAGE]))).toEqual({
      lite: false,
      copilotEligible: false,
    })
  })

  it('reports Copilot eligibility independently of the seat class', () => {
    expect(classifySeat(set([PERMISSIONS.COPILOT_USE]))).toEqual({
      lite: false,
      copilotEligible: true,
    })
    expect(classifySeat(set([PERMISSIONS.ANALYTICS_VIEW]))).toEqual({
      lite: true,
      copilotEligible: false,
    })
  })

  it('classes every system role preset as a full seat', () => {
    // The load-bearing consequence of the derivation: none of the four
    // shipped presets is support-read-only, so no existing install
    // accidentally reclassifies its team as lite the day billing is enabled.
    for (const [role, keys] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
      expect({ role, ...classifySeat(set(keys)) }).toEqual({
        role,
        lite: false,
        copilotEligible: expect.any(Boolean),
      })
    }
  })

  it('classes both legacy role fallbacks as full seats', () => {
    // A principal with no custom role assignment resolves through the legacy
    // preset. Both carry support writes, so a workspace that has never used
    // custom roles bills every teammate at the full rate.
    expect(classifySeat(permissionsForLegacyRole('admin')).lite).toBe(false)
    expect(classifySeat(permissionsForLegacyRole('member')).lite).toBe(false)
  })
})

describe('desiredQuantities', () => {
  it('bills Copilot per paid user, not per permission holder', () => {
    // The operator's rule: "Copilot bills per paid user/month". The eligible
    // count is deliberately ignored here — it is a reporting figure.
    expect(
      desiredQuantities({ full: 3, lite: 5, copilotEligible: 8, total: 8 })
    ).toEqual({
      fullSeat: 3,
      liteSeat: 5,
      copilotSeat: 3,
    })
  })

  it('excludes lite seats from the Copilot quantity', () => {
    // A read-only support viewer has no write action for Copilot to assist.
    // Stated as its own case because it is the assumption most likely to be
    // reversed.
    expect(desiredQuantities({ full: 0, lite: 6, copilotEligible: 6, total: 6 })).toMatchObject({
      copilotSeat: 0,
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

  const seats = (over: Partial<SeatCounts> = {}): SeatCounts => ({
    full: 2,
    lite: 1,
    copilotEligible: 3,
    total: 3,
    ...over,
  })

  it('never sells the Copilot add-on unless it is asked for', () => {
    // The default matters more than any other case in this file: the add-on
    // bills per paid user, so adding it automatically would charge for the
    // whole team on the first upgrade without the customer choosing it.
    expect(checkoutLineItems(config, 'pro', seats())).toEqual([
      { price: 'price_seat', quantity: 2 },
      { price: 'price_lite', quantity: 1 },
      { price: 'price_outcome' },
    ])
    expect(checkoutLineItems(config, 'pro', seats(), { copilot: false })).toEqual(
      checkoutLineItems(config, 'pro', seats())
    )
  })

  it('sells the add-on at the paid-seat quantity when asked for', () => {
    expect(checkoutLineItems(config, 'pro', seats(), { copilot: true })).toEqual([
      { price: 'price_seat', quantity: 2 },
      { price: 'price_lite', quantity: 1 },
      // Equals the full-seat line, never the eligible count (3).
      { price: 'price_copilot', quantity: 2 },
      { price: 'price_outcome' },
    ])
  })

  it('keeps the add-on quantity equal to the seat quantity at the floor', () => {
    // Both lines use the same expression, so they cannot disagree even when
    // the derived count is zero and the floor of one applies.
    const items = checkoutLineItems(
      config,
      'pro',
      seats({ full: 0, lite: 0, copilotEligible: 0, total: 0 }),
      { copilot: true }
    )
    expect(items).toEqual([
      { price: 'price_seat', quantity: 1 },
      { price: 'price_copilot', quantity: 1 },
      { price: 'price_outcome' },
    ])
  })

  it('omits meters with a zero count', () => {
    expect(
      checkoutLineItems(config, 'pro', seats({ full: 3, lite: 0, copilotEligible: 0, total: 3 }))
    ).toEqual([
      { price: 'price_seat', quantity: 3 },
      { price: 'price_outcome' },
    ])
  })

  it('returns nothing for a plan the deployment does not sell', () => {
    expect(checkoutLineItems(config, 'enterprise', seats())).toEqual([])
  })
})

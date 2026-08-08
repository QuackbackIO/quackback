/**
 * The seat classification rule, in isolation from the query that feeds it.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import { classifySeat, type SeatCounts } from '../seats'
import { billableQuantities, checkoutLineItems } from '../seat-sync'
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

  it('never reports a lite seat as Copilot-eligible', () => {
    // A theorem, not a coincidence: `copilot.use` is in
    // SUPPORT_WRITE_PERMISSIONS, so holding it makes the seat full by
    // definition. That is what lets the add-on bill on `full` without ever
    // charging for someone ineligible — and it is worth pinning, because
    // reclassifying `copilot.use` as a support read would break the
    // implication silently while every other test still passed.
    const sets: Array<readonly PermissionKey[]> = [
      [],
      SUPPORT_READ_PERMISSIONS,
      [PERMISSIONS.COPILOT_USE],
      [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.COPILOT_USE],
      [PERMISSIONS.POST_CREATE, PERMISSIONS.CONVERSATION_VIEW],
      [PERMISSIONS.CONVERSATION_REPLY],
      ...Object.values(SYSTEM_ROLE_PERMISSIONS),
    ]
    for (const keys of sets) {
      const { lite, copilotEligible } = classifySeat(set(keys))
      expect({ keys: [...keys].sort(), impliesNotEligible: !lite || !copilotEligible }).toEqual({
        keys: [...keys].sort(),
        impliesNotEligible: true,
      })
    }
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

describe('billableQuantities', () => {
  const pro = {
    seat: 'price_seat',
    liteSeat: 'price_lite',
    copilotSeat: 'price_copilot',
  } as unknown as Parameters<typeof billableQuantities>[1]
  const seatOnly = { seat: 'price_seat' } as unknown as Parameters<typeof billableQuantities>[1]

  it('bills Copilot per paid user, not per permission holder', () => {
    // The operator's rule: "Copilot bills per paid user/month". The eligible
    // count is deliberately ignored — it is a reporting figure.
    expect(billableQuantities({ full: 3, lite: 5, copilotEligible: 8, total: 8 }, pro)).toEqual({
      fullSeat: 3,
      liteSeat: 5,
      copilotSeat: 3,
    })
  })

  it('excludes lite seats from the Copilot quantity', () => {
    // A read-only support viewer has no write action for Copilot to assist.
    // Stated as its own case because it is the assumption most likely to be
    // reversed.
    expect(
      billableQuantities({ full: 2, lite: 6, copilotEligible: 6, total: 8 }, pro)
    ).toMatchObject({ copilotSeat: 2 })
  })

  it('bills nothing for seats nobody occupies when the workspace is all lite', () => {
    // The boundary the two-expression version got wrong. Narrowing "lite" to
    // the customer-support surface makes an all-lite workspace an ordinary
    // configuration — a feedback-only install that has adopted custom roles —
    // and it must not be billed a phantom full seat, nor a Copilot seat for
    // nobody.
    expect(billableQuantities({ full: 0, lite: 3, copilotEligible: 0, total: 3 }, pro)).toEqual({
      fullSeat: 0,
      liteSeat: 3,
      copilotSeat: 0,
    })
  })

  it('counts every teammate as a full seat when the plan sells no lite seat', () => {
    // There is no cheaper product to put them on. Without this rule an
    // all-lite workspace on a seat-only plan produces a checkout with no
    // licensed line items at all.
    expect(
      billableQuantities({ full: 0, lite: 3, copilotEligible: 0, total: 3 }, seatOnly)
    ).toEqual({ fullSeat: 3, liteSeat: 0, copilotSeat: 3 })
  })

  it('is the derivation checkout uses, at every seat shape', () => {
    // The property the defect violated: checkout and the sync must agree.
    // Asserted across shapes rather than at one point, because the previous
    // pair of expressions agreed everywhere EXCEPT zero.
    const shapes: SeatCounts[] = [
      { full: 0, lite: 0, copilotEligible: 0, total: 0 },
      { full: 0, lite: 3, copilotEligible: 0, total: 3 },
      { full: 1, lite: 0, copilotEligible: 1, total: 1 },
      { full: 4, lite: 7, copilotEligible: 2, total: 11 },
    ]
    for (const seats of shapes) {
      const quantities = billableQuantities(seats, pro)
      const lines = checkoutLineItems(config, 'pro', seats, { copilot: true })
      const quantityOf = (price: string) => lines.find((line) => line.price === price)?.quantity ?? 0
      expect({
        seats,
        seat: quantityOf('price_seat'),
        lite: quantityOf('price_lite'),
        copilot: quantityOf('price_copilot'),
      }).toEqual({
        seats,
        seat: quantities.fullSeat,
        lite: quantities.liteSeat,
        copilot: quantities.copilotSeat,
      })
    }
  })
})

describe('checkoutLineItems', () => {
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

  it('omits the seat and add-on lines entirely when the workspace is all lite', () => {
    // No floor. Billing one full seat where nobody occupies one is a phantom
    // charge, and the first sync would push it straight back to zero — either
    // rejecting the update (and 500ing the webhook forever) or charging and
    // crediting a seat that never existed.
    expect(
      checkoutLineItems(
        config,
        'pro',
        seats({ full: 0, lite: 3, copilotEligible: 0, total: 3 }),
        { copilot: true }
      )
    ).toEqual([
      { price: 'price_lite', quantity: 3 },
      { price: 'price_outcome' },
    ])
  })

  it('still produces a licensed line for an all-lite workspace on a seat-only plan', () => {
    // `free` sells no lite seat, so its teammates are full seats. Without
    // that rule this checkout would carry only the metered line, which the
    // provider rejects.
    expect(
      checkoutLineItems(config, 'free', seats({ full: 0, lite: 3, copilotEligible: 0, total: 3 }))
    ).toEqual([{ price: 'price_free_seat', quantity: 3 }])
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

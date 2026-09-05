import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isSameOriginFormPost } from '@/lib/server/http/same-origin-form'
import { PAID_PLAN_IDS, parsePaidPlanId } from '@/lib/shared/billing/checkout-path'
import { PERMISSIONS } from '@/lib/shared/permissions'

export function billingErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'already_on_plan') return 'already_on_plan'
  if (message === 'already_on_addon') return 'already_on_addon'
  if (message === 'not_on_addon') return 'not_on_addon'
  if (message === 'seats_below_usage') return 'seats_below_usage'
  if (message === 'seat_cap_exceeded') return 'seat_cap_exceeded'
  if (message === 'over_free_limits') return 'over_free_limits'
  if (message === 'over_plan_limits') return 'over_plan_limits'
  if (message === 'Authentication required') return 'unauthorized'
  if (message === 'Access denied: Not a team member') return 'not_teammate'
  if (message.startsWith('Access denied:')) return 'forbidden'
  return 'unavailable'
}

/** Browser form POSTs must 303 back to billing. Raw JSON is a dead end. */
export function billingFormErrorResponse(error: unknown, code = billingErrorCode(error)): Response {
  return new Response(null, {
    status: 303,
    headers: { location: `/admin/settings/billing?billing_error=${encodeURIComponent(code)}` },
  })
}

export function billingSessionErrorResponse(error: unknown): Response {
  return billingFormErrorResponse(error)
}

/** Switch to Free after the trial window lapsed is already commercially Free.
 *  Treat that conflict as success so the expired page can confirm Free. */
export function billingDowngradeAlreadyOnPlanResponse(error: unknown): Response | null {
  if (billingErrorCode(error) !== 'already_on_plan') return null
  return new Response(null, {
    status: 303,
    headers: { location: '/admin/settings/billing' },
  })
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('portal') }),
  z.object({
    action: z.literal('checkout'),
    planId: z.enum(PAID_PLAN_IDS),
    billingPeriod: z.enum(['monthly', 'annual']),
    quantity: z.coerce.number().int().positive().optional(),
    // A checked checkbox posts "true"; an unchecked one posts nothing.
    brandingRemoval: z.enum(['true']).optional(),
  }),
  z.object({
    action: z.literal('downgrade'),
    planId: z.literal('free'),
  }),
  z.object({
    action: z.literal('seats'),
    quantity: z.coerce.number().int().positive(),
  }),
  z.object({
    action: z.literal('topup'),
    meter: z.enum(['ai', 'email']),
    packs: z.coerce.number().int().positive(),
  }),
  z.object({
    action: z.literal('branding'),
    billingPeriod: z.enum(['monthly', 'annual']),
  }),
  z.object({
    action: z.literal('branding-remove'),
  }),
])

export const Route = createFileRoute('/api/billing/session')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginFormPost(request)) {
          return Response.json({ error: 'invalid_origin' }, { status: 403 })
        }
        let action: string | undefined
        try {
          const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
          await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
          const form = await request.formData()
          const parsed = actionSchema.safeParse(Object.fromEntries(form.entries()))
          if (!parsed.success) return billingFormErrorResponse(null, 'invalid')
          action = parsed.data.action
          const { getCloudConfig } =
            await import('@/lib/server/domains/settings/cloud/cloud.service')
          const cloud = await getCloudConfig()
          const actionAllowed =
            parsed.data.action === 'portal'
              ? cloud.canManageBilling
              : cloud.canUpgrade || cloud.canManageBilling
          if (!cloud.enabled || !actionAllowed) {
            return billingFormErrorResponse(null, 'unavailable')
          }
          if (parsed.data.action === 'downgrade') {
            const { assertFitsPlan } = await import('@/lib/server/domains/billing/usage-counts')
            await assertFitsPlan(parsed.data.planId)
          }
          if (parsed.data.action === 'checkout' && cloud.plan) {
            const { isPlanDowngrade } = await import('@/lib/shared/billing/plan-action')
            if (isPlanDowngrade(cloud.plan, parsed.data.planId)) {
              const { assertFitsPlan } = await import('@/lib/server/domains/billing/usage-counts')
              await assertFitsPlan(parsed.data.planId)
            }
          }
          const { createHostedBillingSession } = await import('@/lib/server/control-plane/client')
          const session =
            parsed.data.action === 'seats'
              ? await createSeatChangeSession(parsed.data.quantity)
              : parsed.data.action === 'checkout'
                ? await createCheckoutSession(parsed.data)
                : await createHostedBillingSession(parsed.data)
          if (parsed.data.action === 'downgrade' || parsed.data.action === 'checkout') {
            const { clearPendingDowngrade } =
              await import('@/lib/server/domains/billing/pending-downgrade')
            await clearPendingDowngrade()
          }
          const flashSuccess =
            parsed.data.action === 'checkout' || parsed.data.action === 'branding'
          const location =
            typeof session.url === 'string' && session.url.startsWith('https://')
              ? session.url
              : flashSuccess && session.status
                ? '/admin/settings/billing?checkout=success'
                : '/admin/settings/billing'
          return new Response(null, { status: 303, headers: { location } })
        } catch (error) {
          if (action === 'downgrade') {
            const already = billingDowngradeAlreadyOnPlanResponse(error)
            if (already) return already
          }
          return billingSessionErrorResponse(error)
        }
      },
    },
  },
})

/**
 * Same settings-row lock invites take. Hold it across the hosted call so a
 * concurrent invite cannot change the roster after we sampled it.
 */
async function withSettingsLock<T>(
  fn: (tx: import('@/lib/server/db').Transaction) => Promise<T>
): Promise<T> {
  const { db, settings } = await import('@/lib/server/db')
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: settings.id }).from(settings).limit(1).for('update')
    if (!row) throw new Error('Workspace is not set up yet')
    return fn(tx)
  })
}

async function createSeatChangeSession(quantity: number) {
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const { createHostedBillingSession } = await import('@/lib/server/control-plane/client')
  return withSettingsLock(async (tx) => {
    const seats = await countSeatUsage(tx)
    if (quantity < seats.used) {
      throw new Error('seats_below_usage')
    }
    return createHostedBillingSession({ action: 'seats', quantity })
  })
}

/** Floor seat-billed checkout at live usage so a stale form cannot under-seat.
 *  Workspace-priced plans stay quantity 1. */
async function createCheckoutSession(input: {
  planId: (typeof PAID_PLAN_IDS)[number]
  billingPeriod: 'monthly' | 'annual'
  quantity?: number
  brandingRemoval?: 'true'
}) {
  const planId = parsePaidPlanId(input.planId)
  if (!planId) throw new Error('invalid')
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const { createHostedBillingSession, fetchBillingCatalogue } =
    await import('@/lib/server/control-plane/client')
  return withSettingsLock(async (tx) => {
    const [seats, catalogue] = await Promise.all([
      countSeatUsage(tx),
      fetchBillingCatalogue().catch(() => null),
    ])
    const billedPer = catalogue?.plans.find(
      (plan) => parsePaidPlanId(plan.id) === planId
    )?.billedPer
    const quantity =
      billedPer === 'workspace' ? 1 : Math.max(input.quantity ?? seats.used, seats.used, 1)
    return createHostedBillingSession({
      action: 'checkout',
      planId,
      billingPeriod: input.billingPeriod,
      quantity,
      ...(input.brandingRemoval === 'true' ? { brandingRemoval: true } : {}),
    })
  })
}

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isSameOriginFormPost } from '@/lib/server/http/same-origin-form'
import { PERMISSIONS } from '@/lib/shared/permissions'

export function billingSessionErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Billing is temporarily unavailable.'
  if (message === 'already_on_plan') {
    return Response.json({ error: 'already_on_plan' }, { status: 409 })
  }
  if (message === 'seats_below_usage') {
    return Response.json({ error: 'seats_below_usage' }, { status: 400 })
  }
  if (message === 'Authentication required') {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (message === 'Access denied: Not a team member') {
    return Response.json({ error: 'not_teammate' }, { status: 403 })
  }
  if (message.startsWith('Access denied:')) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  return Response.json({ error: message }, { status: 503 })
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('portal') }),
  z.object({
    action: z.literal('checkout'),
    planId: z.enum(['growth', 'pro', 'scale']),
    billingPeriod: z.enum(['monthly', 'annual']),
    quantity: z.coerce.number().int().positive().optional(),
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
])

export const Route = createFileRoute('/api/billing/session')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginFormPost(request)) {
          return Response.json({ error: 'invalid_origin' }, { status: 403 })
        }
        try {
          const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
          await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
          const form = await request.formData()
          const parsed = actionSchema.safeParse(Object.fromEntries(form.entries()))
          if (!parsed.success)
            return Response.json({ error: 'invalid_billing_action' }, { status: 400 })
          const { getCloudConfig } =
            await import('@/lib/server/domains/settings/cloud/cloud.service')
          const cloud = await getCloudConfig()
          const actionAllowed =
            parsed.data.action === 'portal'
              ? cloud.canManageBilling
              : cloud.canUpgrade || cloud.canManageBilling
          if (!cloud.enabled || !actionAllowed) {
            return Response.json({ error: 'billing_action_unavailable' }, { status: 403 })
          }
          const { createHostedBillingSession } = await import('@/lib/server/control-plane/client')
          const session =
            parsed.data.action === 'seats'
              ? await createSeatChangeSession(parsed.data.quantity)
              : await createHostedBillingSession(
                  parsed.data.action === 'checkout'
                    ? {
                        ...parsed.data,
                        quantity: await checkoutQuantity(parsed.data.quantity),
                      }
                    : parsed.data
                )
          const location =
            typeof session.url === 'string' && session.url.startsWith('https://')
              ? session.url
              : '/admin/settings/billing'
          return new Response(null, { status: 303, headers: { location } })
        } catch (error) {
          return billingSessionErrorResponse(error)
        }
      },
    },
  },
})

/**
 * Recount under the same settings-row lock invites use, and hold it until the
 * hosted session returns so a concurrent invite cannot sneak in a fifth seat
 * after we approved a cut to four.
 */
async function createSeatChangeSession(quantity: number) {
  const { db, settings } = await import('@/lib/server/db')
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const { createHostedBillingSession } = await import('@/lib/server/control-plane/client')
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: settings.id }).from(settings).limit(1).for('update')
    if (!row) throw new Error('Workspace is not set up yet')
    const seats = await countSeatUsage(tx)
    if (quantity < seats.used) {
      throw new Error('seats_below_usage')
    }
    return createHostedBillingSession({ action: 'seats', quantity })
  })
}

/** Floor checkout seats at live usage so a stale form cannot under-seat. */
async function checkoutQuantity(requested?: number): Promise<number> {
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const seats = await countSeatUsage()
  return Math.max(requested ?? seats.used, seats.used, 1)
}

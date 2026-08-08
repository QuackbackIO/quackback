/**
 * Server functions for self-serve billing.
 *
 * Every one of these is gated on `billing.manage`, which the RBAC catalogue
 * has reserved for exactly this since custom roles shipped — it is the one
 * permission Owner holds and Admin does not ("Full access except billing").
 * So the gate is the product's existing answer to "who may see the invoice",
 * not a new one invented here.
 *
 * All of them return null / refuse when no billing provider is configured, so
 * a self-hosted install that somehow reached one of these gets nothing rather
 * than an error mentioning a feature it does not have.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PLAN_IDS } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'billing-fn' })

const checkoutSchema = z.object({
  plan: z.enum(PLAN_IDS),
  /** Path the provider returns the browser to. Same-origin, path only. */
  returnPath: z
    .string()
    .startsWith('/', 'returnPath must be a path')
    // An absolute URL or a protocol-relative one here would let a caller
    // point the provider's redirect at another origin.
    .refine((value) => !value.startsWith('//'), 'returnPath must be same-origin')
    .default('/admin/settings/billing'),
})

const portalSchema = z.object({
  returnPath: z
    .string()
    .startsWith('/', 'returnPath must be a path')
    .refine((value) => !value.startsWith('//'), 'returnPath must be same-origin')
    .default('/admin/settings/billing'),
})

/**
 * Everything the billing page renders. Null when billing is unconfigured,
 * which is what makes the page render nothing on a self-hosted install even
 * if someone navigates to the URL directly.
 */
export const fetchBillingOverviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { getBillingOverview } = await import('@/lib/server/domains/billing/billing.service')
  return await getBillingOverview()
})

/** Begin a self-serve upgrade. Returns the provider-hosted checkout URL. */
export const startCheckoutFn = createServerFn({ method: 'POST' })
  .validator(checkoutSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
    const { startCheckout } = await import('@/lib/server/domains/billing/billing.service')
    const result = await startCheckout({
      plan: data.plan,
      actorEmail: auth.user.email ?? null,
      returnPath: data.returnPath,
    })
    log.info({ plan: data.plan }, 'checkout session started')
    return result
  })

/** Open the provider's management surface for cards, receipts and cancellation. */
export const openBillingPortalFn = createServerFn({ method: 'POST' })
  .validator(portalSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
    const { openBillingPortal } = await import('@/lib/server/domains/billing/billing.service')
    return await openBillingPortal(data.returnPath)
  })

/**
 * Force a full reconcile.
 *
 * The webhook path keeps this current on its own; this exists because a
 * missed delivery should be recoverable by a human in one click rather than
 * by waiting, and because it makes the whole pipeline demonstrable without a
 * provider event.
 */
export const reconcileBillingFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { reconcileBilling } = await import('@/lib/server/domains/billing/billing.service')
  const result = await reconcileBilling()
  log.info({ plan: result.plan }, 'billing reconciled on request')
  return result
})

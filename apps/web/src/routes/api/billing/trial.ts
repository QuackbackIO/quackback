import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isSameOriginFormPost } from '@/lib/server/http/same-origin-form'
import { PAID_PLAN_IDS, parsePaidPlanId } from '@/lib/shared/billing/checkout-path'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { billingFormErrorResponse, billingSessionErrorResponse } from './session'

const trialSchema = z.object({
  planId: z.enum(PAID_PLAN_IDS),
  /** Admin page the prompt was raised on, so the trial lands back on the now-unlocked feature. */
  returnTo: z.string().optional(),
})

/**
 * Only a same-origin admin path may be returned to. Anything else — absolute
 * or protocol-relative URLs, backslashes, control characters, non-admin paths —
 * falls back to Plan & billing so the form can never be used as an open redirect.
 */
export function trialReturnPath(returnTo: string | undefined): string {
  if (!returnTo) return '/admin/settings/billing'
  if (!/^\/admin(?:[/?]|$)/.test(returnTo)) return '/admin/settings/billing'
  if (/[\\\s]/.test(returnTo)) return '/admin/settings/billing'
  return returnTo
}

export const Route = createFileRoute('/api/billing/trial')({
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
          const parsed = trialSchema.safeParse(Object.fromEntries(form.entries()))
          if (!parsed.success) {
            return billingFormErrorResponse(null, 'invalid')
          }
          const { getCloudConfig } =
            await import('@/lib/server/domains/settings/cloud/cloud.service')
          const cloud = await getCloudConfig()
          if (!cloud.enabled || !cloud.canUpgrade) {
            return billingFormErrorResponse(null, 'unavailable')
          }
          const planId = parsePaidPlanId(parsed.data.planId)
          if (!planId) {
            return billingFormErrorResponse(null, 'invalid')
          }
          const { startWorkspaceTrial } = await import('@/lib/server/control-plane/client')
          await startWorkspaceTrial(planId)
          const { clearPendingDowngrade } =
            await import('@/lib/server/domains/billing/pending-downgrade')
          await clearPendingDowngrade()
          return new Response(null, {
            status: 303,
            headers: { location: trialReturnPath(parsed.data.returnTo) },
          })
        } catch (error) {
          return billingSessionErrorResponse(error)
        }
      },
    },
  },
})

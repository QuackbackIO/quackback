import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isSameOriginFormPost } from '@/lib/server/http/same-origin-form'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { billingFormErrorResponse, billingSessionErrorResponse } from './session'

const trialSchema = z.object({
  planId: z.enum(['growth', 'pro', 'scale']),
})

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
          const { startWorkspaceTrial } = await import('@/lib/server/control-plane/client')
          await startWorkspaceTrial(parsed.data.planId)
          return new Response(null, {
            status: 303,
            headers: { location: '/admin/settings/billing' },
          })
        } catch (error) {
          return billingSessionErrorResponse(error)
        }
      },
    },
  },
})

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const saveSegmentConnectionFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      incomingSecret: z.string().min(16).max(512),
      writeKey: z.string().min(1).max(512).optional(),
      outgoingEnabled: z.boolean().default(false),
    })
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { saveIntegration } = await import('../integrations/save')
    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    await saveIntegration('segment', {
      principalId: auth.principal.id,
      secrets: {
        incomingSecret: data.incomingSecret,
        ...(data.writeKey ? { writeKey: data.writeKey } : {}),
      },
      config: { outgoingEnabled: data.outgoingEnabled },
    })
    return { success: true }
  })

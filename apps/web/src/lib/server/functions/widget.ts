import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'

const createWidgetIdentifyTokenSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
})

export const createWidgetIdentifyTokenFn = createServerFn({ method: 'POST' })
  .validator(createWidgetIdentifyTokenSchema)
  .handler(async ({ data }) => {
    const { getWidgetConfig, getWidgetSecret } =
      await import('@/lib/server/domains/settings/settings.widget')
    const { createWidgetIdentityToken } = await import('@/lib/server/widget/identity-token')

    const widgetConfig = await getWidgetConfig()
    if (widgetConfig.identifyVerification) {
      throw new Error('Inline widget email capture is disabled when verified identity is required')
    }

    const secret = await getWidgetSecret()
    if (!secret) {
      throw new Error('Widget secret not configured')
    }

    return {
      ssoToken: createWidgetIdentityToken(
        {
          email: data.email,
          name: data.name ?? data.email.split('@')[0],
        },
        secret
      ),
    }
  })

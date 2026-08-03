import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { resolveWidgetContext } from '@/lib/server/widget/context'

const widgetContextInputSchema = z.object({
  applicationKey: z.string().optional(),
  environment: z.string().optional(),
  hostOrigin: z.string().optional(),
})

export const resolveWidgetContextFn = createServerFn({ method: 'GET' })
  .inputValidator(widgetContextInputSchema)
  .handler(async ({ data }) => {
    const headers = getRequestHeaders()
    const request = new Request('https://widget-context.local/widget', { headers })
    const context = await resolveWidgetContext(request, data)

    return {
      source: context.source,
      profileId: context.profileId,
      applicationKey: context.applicationKey,
      environment: context.environment,
      publicConfig: context.publicConfig,
      contentFilters: context.contentFilters,
      supportConfig: context.supportConfig,
      contextToken: context.contextToken,
      denialReason: context.denialReason,
    }
  })

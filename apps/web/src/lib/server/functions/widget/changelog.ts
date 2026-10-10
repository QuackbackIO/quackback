import { createServerFn } from '@tanstack/react-start'
import { getChangelogSchema, listPublicChangelogsSchema } from '@/lib/shared/schemas/changelog'

export const widgetGetPublicChangelogFn = createServerFn({ method: 'GET' })
  .validator(getChangelogSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runGetPublicChangelog } = await import('../changelog')
    return runGetPublicChangelog(await getOptionalWidgetAuth(), data)
  })

export const widgetListPublicChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listPublicChangelogsSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runListPublicChangelogs } = await import('../changelog')
    return runListPublicChangelogs(await getOptionalWidgetAuth(), data)
  })

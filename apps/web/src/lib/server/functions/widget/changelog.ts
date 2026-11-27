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
    const { runListWidgetChangelogs } = await import('../changelog')
    return runListWidgetChangelogs(await getOptionalWidgetAuth(), data)
  })

export const widgetListChangelogCategoriesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runListChangelogCategories } = await import('../changelog-categories')
    return runListChangelogCategories(await getOptionalWidgetAuth())
  }
)

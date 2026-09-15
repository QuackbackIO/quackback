/**
 * Widget BFF for changelog. Portal keeps changelog.ts on cookie/site auth.
 */
import { createServerFn } from '@tanstack/react-start'
import { getChangelogSchema, listPublicChangelogsSchema } from '@/lib/shared/schemas/changelog'
import { runGetPublicChangelog, runListPublicChangelogs } from '../changelog'
import { getOptionalWidgetAuth } from '../widget-auth'

export const widgetGetPublicChangelogFn = createServerFn({ method: 'GET' })
  .validator(getChangelogSchema)
  .handler(async ({ data }) => {
    return runGetPublicChangelog(await getOptionalWidgetAuth(), data)
  })

export const widgetListPublicChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listPublicChangelogsSchema)
  .handler(async ({ data }) => {
    return runListPublicChangelogs(await getOptionalWidgetAuth(), data)
  })

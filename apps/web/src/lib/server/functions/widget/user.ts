/**
 * Widget BFF for visitor account reads. Portal keeps user.ts on cookie/site auth.
 */
import { createServerFn } from '@tanstack/react-start'
import { runGetUserStats } from '../user'
import { requireWidgetAuth } from '../widget-auth'

export const widgetGetUserStatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await requireWidgetAuth()
  return runGetUserStats(ctx.principal.id)
})

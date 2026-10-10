import { createServerFn } from '@tanstack/react-start'

export const widgetGetUserStatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireWidgetAuth } = await import('../widget-auth')
  const { runGetUserStats } = await import('../user')
  const ctx = await requireWidgetAuth()
  return runGetUserStats(ctx.principal.id)
})

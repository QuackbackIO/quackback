import { createFileRoute, notFound, redirect, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterConfig } from '@/lib/server/domains/settings'

/** Check if the current request has a valid session. */
const checkHasSession = createServerFn({ method: 'GET' }).handler(async () => {
  const { hasSessionCookie } = await import('@/lib/server/functions/auth-helpers')
  if (!hasSessionCookie()) return false
  const { auth } = await import('@/lib/server/auth')
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return !!session
})

export const Route = createFileRoute('/_portal/hc')({
  beforeLoad: async ({ context }) => {
    const { settings } = context

    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    if (!helpCenterConfig?.enabled) throw notFound()

    if (helpCenterConfig.access === 'authenticated') {
      const hasSession = await checkHasSession()
      if (!hasSession) {
        throw redirect({ to: '/auth/login', replace: true })
      }
    }
  },
  loader: ({ context }) => {
    const { settings } = context
    const helpCenterConfig = (settings?.helpCenterConfig as HelpCenterConfig | null) ?? null
    return { helpCenterConfig }
  },
  head: ({ loaderData }) => {
    const meta: Array<Record<string, string>> = []
    if (loaderData?.helpCenterConfig?.access === 'authenticated') {
      meta.push({ name: 'robots', content: 'noindex, nofollow' })
    }
    return { meta }
  },
  component: HelpCenterLayoutRoute,
})

function HelpCenterLayoutRoute() {
  return <Outlet />
}

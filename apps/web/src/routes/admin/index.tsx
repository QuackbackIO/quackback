import { Suspense, useEffect } from 'react'
import { FormattedMessage } from 'react-intl'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ScrollArea } from '@/components/ui/scroll-area'
import { OverviewDashboard } from '@/components/admin/admin-overview'
import { HomeActions } from '@/components/admin/home-actions'
import {
  AskQuackbackInline,
  WorkspaceCopilotFocused,
  useWorkspaceCopilotEnabled,
  useWorkspaceCopilotFocused,
} from '@/components/admin/ask/workspace-copilot-context'
import { HomeGettingStarted } from '@/components/onboarding/home-launch-plan'
import { HomeTryItYourself } from '@/components/onboarding/home-try-it'
import { adminQueries } from '@/lib/client/queries/admin'
import { adminOverviewQueries } from '@/lib/client/queries/admin-overview'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import { isAdmin } from '@/lib/shared/roles'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  useUserRole,
  useWorkspaceSettings,
  useSessionContext,
  useBaseUrl,
} from '@/lib/client/hooks/use-root-context'

export const Route = createFileRoute('/admin/')({
  loader: async ({ context }) => {
    const admin = isAdmin(context.userRole)
    let modulesChanged = false
    if (admin) {
      const ready = await ensureOnboardingHomeReadyFn()
      modulesChanged = ready.modulesChanged
      await context.queryClient.ensureQueryData(adminQueries.onboardingStatus())
    }
    await context.queryClient.ensureQueryData(adminOverviewQueries.get())
    return { modulesChanged }
  },
  component: AdminOverviewPage,
})

function AdminOverviewPage() {
  const router = useRouter()
  const { modulesChanged } = Route.useLoaderData()
  useEffect(() => {
    if (modulesChanged) void router.invalidate()
  }, [modulesChanged, router])
  const session = useSessionContext()
  const baseUrl = useBaseUrl()
  const userRole = useUserRole()
  const settings = useWorkspaceSettings()
  const copilotEnabled = useWorkspaceCopilotEnabled()
  const focused = useWorkspaceCopilotFocused()
  const admin = isAdmin(userRole)
  const flags = settings?.featureFlags as FeatureFlags | undefined

  if (focused) return <WorkspaceCopilotFocused />

  return (
    <ScrollArea className="h-full">
      <div
        className={cn('px-4 pb-16 sm:px-6', copilotEnabled ? 'pt-10 sm:pt-20' : 'pt-8 sm:pt-10')}
      >
        <div className={cn('mx-auto w-full space-y-6', copilotEnabled ? 'max-w-3xl' : 'max-w-5xl')}>
          <OverviewDashboard
            actions={<HomeActions flags={flags} />}
            header={
              <header className="space-y-5">
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold">
                    <FormattedMessage
                      id="onboarding.home.greeting"
                      defaultMessage="Welcome, {name}"
                      values={{ name: session?.user.name || settings?.name || 'Quackback' }}
                    />
                  </h1>
                  <a href={baseUrl} className="text-sm text-muted-foreground hover:underline">
                    {baseUrl ? new URL(baseUrl).host : settings?.name}
                  </a>
                </div>
                <AskQuackbackInline />
              </header>
            }
            banner={
              admin ? (
                <Suspense fallback={null}>
                  <HomeGettingStarted portalUrl={baseUrl} compact={copilotEnabled}>
                    <HomeTryItYourself flags={flags} />
                  </HomeGettingStarted>
                </Suspense>
              ) : null
            }
          />
        </div>
      </div>
    </ScrollArea>
  )
}

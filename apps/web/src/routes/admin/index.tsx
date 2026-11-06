import { lazy, Suspense, useEffect, useRef } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HomeActions } from '@/components/admin/home-actions'
import { OverviewDashboard } from '@/components/admin/admin-overview'
import { HomeLaunchArea, HomeTourArea } from '@/components/onboarding/home-try-it'
import { HomeGreeting } from '@/components/onboarding/home-greeting'
import { LaunchMessages } from '@/components/onboarding/launch-messages'
import { launchStatusQuery } from '@/components/onboarding/use-launch-plan'
import { adminQueries } from '@/lib/client/queries/admin'
import { adminOverviewQueries } from '@/lib/client/queries/admin-overview'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import { DEFAULT_LOCALE, loadLaunchMessages } from '@/lib/shared/i18n'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdmin } from '@/lib/shared/roles'
import { launchPlanLeadsHome } from '@/lib/shared/launch-checklist'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  useUserRole,
  useWorkspaceSettings,
  useSessionContext,
  useBaseUrl,
  useGithubStarPrompt,
  useHasPermission,
} from '@/lib/client/hooks/use-root-context'

export const Route = createFileRoute('/admin/')({
  loader: async ({ context }) => {
    // Home's own strings, which the admin seed leaves out.
    const launchMessages = loadLaunchMessages(context.acceptLanguageLocale ?? DEFAULT_LOCALE)
    const admin = isAdmin(context.userRole)
    let modulesChanged = false
    if (admin) {
      const ready = await ensureOnboardingHomeReadyFn()
      modulesChanged = ready.modulesChanged
    }
    // The launch status decides the plan, and for everyone on the team the greeting.
    if (admin || (context.permissions ?? []).includes(PERMISSIONS.MEMBER_VIEW)) {
      await context.queryClient.ensureQueryData(adminQueries.onboardingStatus())
    }
    await context.queryClient.ensureQueryData(adminOverviewQueries.get())
    return { modulesChanged, launchMessages: await launchMessages }
  },
  component: AdminOverviewPage,
})

const HomeGithubStarPrompt = lazy(() =>
  import('@/components/admin/github-star-prompt').then((m) => ({
    default: m.HomeGithubStarPrompt,
  }))
)

function AdminOverviewPage() {
  const { launchMessages } = Route.useLoaderData()
  return (
    <LaunchMessages messages={launchMessages}>
      <AdminHome />
    </LaunchMessages>
  )
}

function AdminHome() {
  const router = useRouter()
  const { modulesChanged } = Route.useLoaderData()
  useEffect(() => {
    if (modulesChanged) void router.invalidate()
  }, [modulesChanged, router])
  const session = useSessionContext()
  const baseUrl = useBaseUrl()
  const userRole = useUserRole()
  const settings = useWorkspaceSettings()
  const canSeeTeam = useHasPermission(PERMISSIONS.MEMBER_VIEW)
  const admin = isAdmin(userRole)
  const flags = settings?.featureFlags as FeatureFlags | undefined
  // The owner's launch plan leads Home until the first win; then the
  // workspace's counts take its place, as they do for a teammate.
  const launchStatus = useQuery({
    ...launchStatusQuery({ poll: false }),
    enabled: admin || canSeeTeam,
  })
  const firstSessions = launchPlanLeadsHome(launchStatus.data)
  const planLeads = admin && firstSessions
  // The greeting is settled as Home opens, so a first win mid-visit does not change it.
  const welcome = useRef<boolean | null>(null)
  if (welcome.current === null && launchStatus.data) welcome.current = firstSessions
  const branding = (settings as { brandingData?: { name?: string } } | undefined)?.brandingData

  // The portal's address shows once, in the launch plan's picture of it.
  const header = (
    <header>
      <HomeGreeting
        name={session?.user.name}
        email={session?.user.email}
        welcome={welcome.current ?? firstSessions}
        workspace={branding?.name ?? settings?.name}
      />
    </header>
  )
  // The owner's launch plan and the tour offer, in the launch window only. A
  // teammate gets their own first run: the tour offer, without the plan.
  const plan =
    admin || canSeeTeam ? (
      <Suspense fallback={null}>
        <HomeLaunchArea portalUrl={baseUrl} member={!admin} />
      </Suspense>
    ) : null
  // The tour offer is Home's last block, in the page, so it never covers the plan.
  const githubStarPrompt = useGithubStarPrompt()
  // Self-hosted only: the one-time GitHub star ask, for someone the card never reached.
  const tourOffer =
    admin || canSeeTeam ? (
      <>
        <HomeTourArea member={!admin} />
        {githubStarPrompt ? (
          <Suspense fallback={null}>
            <HomeGithubStarPrompt />
          </Suspense>
        ) : null}
      </>
    ) : null

  return (
    <ScrollArea className="h-full">
      <div className="px-4 pt-8 pb-16 sm:px-6 sm:pt-10">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <OverviewDashboard
            actions={<HomeActions flags={flags} />}
            header={header}
            banner={plan}
            emptyStates={!planLeads}
          />
          {tourOffer}
        </div>
      </div>
    </ScrollArea>
  )
}

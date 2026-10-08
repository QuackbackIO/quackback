import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HomeActions } from '@/components/admin/home-actions'
import { copilotAvailabilityQuery, useCopilotHome } from '@/components/admin/ask/copilot-on-home'
import { CopilotCreditsLock } from '@/components/admin/ask/copilot-credits-lock'
import { OverviewCounts, OverviewDashboard } from '@/components/admin/admin-overview'
import { HomeLaunchArea } from '@/components/onboarding/home-try-it'
import { HomeGreeting } from '@/components/onboarding/home-greeting'
import { LaunchMessages } from '@/components/onboarding/launch-messages'
import { adminQueries } from '@/lib/client/queries/admin'
import { adminOverviewQueries } from '@/lib/client/queries/admin-overview'
import { useHasPermission } from '@/lib/client/use-permissions'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import { DEFAULT_LOCALE, loadLaunchMessages } from '@/lib/shared/i18n'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdmin } from '@/lib/shared/roles'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  useUserRole,
  useWorkspaceSettings,
  useSessionContext,
  useBaseUrl,
} from '@/lib/client/hooks/use-root-context'

// Only Home pays for the chat: its code loads with this chunk.
const CopilotHome = lazy(() =>
  import('@/components/admin/ask/copilot-home').then((module) => ({
    default: module.CopilotHome,
  }))
)

export const Route = createFileRoute('/admin/')({
  validateSearch: (search: Record<string, unknown>): { copilotThread?: string } =>
    typeof search.copilotThread === 'string' && search.copilotThread.startsWith('workspace:')
      ? { copilotThread: search.copilotThread }
      : {},
  loader: async ({ context }) => {
    // Home's own strings, which the admin seed leaves out.
    const launchMessages = loadLaunchMessages(context.acceptLanguageLocale ?? DEFAULT_LOCALE)
    const admin = isAdmin(context.userRole)
    let modulesChanged = false
    if (admin) {
      const ready = await ensureOnboardingHomeReadyFn()
      modulesChanged = ready.modulesChanged
      await context.queryClient.ensureQueryData(adminQueries.onboardingStatus())
    }
    // Home is the Copilot chat when it is available to this teammate, so the
    // answer is known before Home renders.
    const copilot =
      context.settings?.featureFlags?.copilotHome === true &&
      (context.permissions ?? []).includes(PERMISSIONS.COPILOT_USE)
        ? await context.queryClient
            .ensureQueryData(copilotAvailabilityQuery(context.principal?.id))
            .catch(() => null)
        : null
    if (!copilot?.enabled) await context.queryClient.ensureQueryData(adminOverviewQueries.get())
    return { modulesChanged, launchMessages: await launchMessages }
  },
  component: AdminOverviewPage,
})

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
  const { copilotThread } = Route.useSearch()
  useEffect(() => {
    if (modulesChanged) void router.invalidate()
  }, [modulesChanged, router])
  const session = useSessionContext()
  const baseUrl = useBaseUrl()
  const userRole = useUserRole()
  const settings = useWorkspaceSettings()
  const copilot = useCopilotHome()
  const copilotOnHome = copilot.onHome
  // Out of AI credits, Copilot stays on Home greyed out, with the way to get more.
  const locked = copilotOnHome && copilot.credits !== 'available' ? copilot.credits : null
  const canUseCopilot = useHasPermission(PERMISSIONS.COPILOT_USE)
  const canSeeTeam = useHasPermission(PERMISSIONS.MEMBER_VIEW)
  const admin = isAdmin(userRole)
  const flags = settings?.featureFlags as FeatureFlags | undefined

  const header = (
    <header className="space-y-2">
      <HomeGreeting name={session?.user.name} email={session?.user.email} />
      <a href={baseUrl} className="text-sm text-muted-foreground hover:underline">
        {baseUrl ? new URL(baseUrl).host : settings?.name}
      </a>
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

  // A review link opens its thread even when new chats are unavailable.
  if (canUseCopilot && (copilotOnHome || copilotThread))
    return (
      <Suspense fallback={copilotThread ? null : <HomeFrame>{header}</HomeFrame>}>
        <CopilotHome
          threadKey={copilotThread}
          canAsk={copilotOnHome && !locked}
          header={header}
          locked={locked ? <CopilotCreditsLock credits={locked} /> : undefined}
          below={
            admin ? (
              plan
            ) : (
              <>
                {plan}
                <OverviewCounts />
              </>
            )
          }
        />
      </Suspense>
    )

  return (
    <ScrollArea className="h-full">
      <div className="px-4 pt-8 pb-16 sm:px-6 sm:pt-10">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <OverviewDashboard
            actions={<HomeActions flags={flags} />}
            header={header}
            banner={plan}
          />
        </div>
      </div>
    </ScrollArea>
  )
}

/** The chat-first Home frame, shown while its code loads. */
function HomeFrame({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-10 pb-16 sm:px-6 sm:pt-20">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {children}
        <div className="h-[118px] rounded-2xl border bg-card" aria-hidden="true" />
      </div>
    </div>
  )
}

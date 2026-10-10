import { useEffect, type ComponentProps } from 'react'
import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { IntlProvider } from 'react-intl'
import { SearchPaletteProvider } from '@/components/admin/ask/search-palette'
import { AdminWorkspaceFrame } from '@/components/admin/admin-workspace-frame'
import { useAdminPresence } from '@/lib/client/hooks/use-admin-presence'
import { DEFAULT_LOCALE, adminSeedMessages, loadMessages } from '@/lib/shared/i18n'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { adminQueries } from '@/lib/client/queries/admin'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { unreadCountQuery } from '@/lib/client/hooks/use-notifications-queries'
import { getLatestVersion, isNewerVersion } from '@/lib/server/functions/version'
import { AdminProductTourProvider } from '@/components/onboarding/admin-product-tour'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { ArticleModal, ChangelogModal, PostModal } from '@/components/admin/entity-modals'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UpdateBanner } from '@/components/admin/update-banner'
import { PlanNoticeBanner } from '@/components/admin/plan-notice-banner'
import { getPlanNotice } from '@/lib/server/functions/plan-notice'
import { CloudQuackbackWidget } from '@/components/shared/cloud-quackback-widget'
import { FileViewerProvider, scrollToMessage } from '@/components/shared/files/file-viewer-context'
import { useHasPermission } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { createRouteContextMemo } from '@/lib/client/route-context-memo'
import type { requireWorkspaceRole } from '@/lib/server/functions/workspace-utils'
import { useFeatureFlag, useProductEnabled } from '@/lib/client/hooks/use-root-context'
import { useToasterLocale } from '@/components/ui/use-toaster-locale'

/** What the admin pages read from the role guard's answer. */
type AdminGuard = Pick<
  Awaited<ReturnType<typeof requireWorkspaceRole>>,
  'user' | 'principal' | 'permissions'
>

/**
 * The role guard's answer holds for every admin page until the viewer or
 * their role changes, so navigations and preloads share one call (see
 * route-context-memo.ts for what expires it).
 */
const adminGuard = createRouteContextMemo<AdminGuard>()

async function loadAdminGuard(callbackUrl: string): Promise<AdminGuard> {
  const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
  // The page being opened rides along so a signed-out visitor returns to it.
  const { user, principal, permissions } = await requireWorkspaceRole({
    data: { allowedRoles: ['admin', 'member'], callbackUrl },
  })
  return { user, principal, permissions }
}

export const Route = createFileRoute('/admin')({
  validateSearch: (
    search: Record<string, unknown>
  ): { post?: string; entry?: string; article?: string } => {
    const next: { post?: string; entry?: string; article?: string } = {}
    if (typeof search.post === 'string') next.post = search.post
    if (typeof search.entry === 'string') next.entry = search.entry
    if (typeof search.article === 'string') next.article = search.article
    return next
  },
  beforeLoad: async ({ location, context }) => {
    // Skip auth for public admin routes (login, signup)
    // These are child routes but should be publicly accessible
    const publicPaths = ['/admin/login', '/admin/signup']
    if (publicPaths.includes(location.pathname)) {
      return {}
    }

    // Only team members (admin, member roles) can access admin dashboard
    // Portal users (role='user') don't have access to this.
    // Role guard first: it throws a sign-in redirect. The billing helper's
    // requireAuth() throws a plain Error, so racing the two can surface an
    // error page for an unauthenticated visitor.
    const { user, principal, permissions } = await adminGuard.get(() =>
      loadAdminGuard(location.href)
    )

    // Two billing locks keep billing managers on billing pages: a pending plan
    // downgrade (to the pages where they get under the new plan's limits), and
    // a trial that ended with no plan chosen, once its grace period is over (to
    // the plan picker). Only a billing manager of a workspace with plan billing
    // (cloudEnabled) can be held, so only they load and pay for the check.
    if (context.cloudEnabled && permissions.includes(PERMISSIONS.BILLING_MANAGE)) {
      const { holdOnBilling } = await import('@/lib/client/admin-billing-lock')
      if (await holdOnBilling(location.pathname)) {
        throw redirect({ href: '/admin/settings/billing' })
      }
    }

    return {
      user,
      principal,
      permissions,
    }
  },
  loader: async ({ context, location }) => {
    // Skip for public admin routes (login, signup) - they have their own layouts
    const publicPaths = ['/admin/login', '/admin/signup']
    if (publicPaths.includes(location.pathname)) {
      return {
        user: null,
        initialUserData: null,
        latestVersion: null,
        updateBannerDismissedVersion: null,
        currentUser: null,
        planNotice: null,
        inLaunchWindow: false,
        locale: DEFAULT_LOCALE,
        messages: adminSeedMessages(await loadMessages(DEFAULT_LOCALE)),
      }
    }

    // Auth is already validated in beforeLoad - user and principal are guaranteed here
    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
    }
    // The rail's review badge is only asked for by viewers who can act on it.
    const warmModeration =
      isProductEnabled(context.settings?.featureFlags, 'feedback') &&
      (context.permissions ?? []).includes(PERMISSIONS.POST_APPROVE)

    const locale = context.acceptLanguageLocale ?? DEFAULT_LOCALE
    const [avatarData, latestRelease, planNotice, messages, launchWindow] = await Promise.all([
      fetchUserAvatar({
        data: { userId: user.id, fallbackImageUrl: user.image },
      }),
      getLatestVersion(),
      getPlanNotice(),
      loadMessages(locale).then(adminSeedMessages),
      // Only cloud loads the help launcher, so only cloud asks whether to hide it.
      context.cloudEnabled
        ? import('@/lib/server/functions/onboarding-progress')
            .then((module) => module.getLaunchWindowOpenFn())
            .catch(() => ({ open: false }))
        : { open: false },
      // The rail's unread badge rides the document rather than a request of
      // its own after hydration. Unreadable now, it is left to the bell.
      context.queryClient.ensureQueryData(unreadCountQuery()).catch(() => null),
      // The same goes for the count of posts waiting for review.
      warmModeration
        ? context.queryClient.ensureQueryData(adminQueries.moderationStatus()).catch(() => null)
        : null,
    ])

    const latestVersion =
      latestRelease && isNewerVersion(__APP_VERSION__, latestRelease.version) ? latestRelease : null

    const initialUserData = {
      name: user.name,
      email: user.email,
      avatarUrl: avatarData.avatarUrl,
      chatAvailability: (principal.chatAvailability ?? 'online') as 'online' | 'away',
    }

    return {
      user,
      initialUserData,
      latestVersion,
      updateBannerDismissedVersion: context.updateBannerDismissedVersion ?? null,
      planNotice,
      inLaunchWindow: launchWindow.open,
      locale,
      messages,
      currentUser: {
        name: user.name,
        email: user.email,
        principalId: principal.id,
      },
    }
  },
  // The layout loader (avatar/version/plan-notice/messages) is stable across
  // intra-admin navigation, so cache it for 5 min instead of re-running the
  // Promise.all on every child route change.
  staleTime: 5 * 60 * 1000,
  component: AdminLayout,
})

function useEntityIdFromUrl(key: 'post' | 'entry' | 'article'): string | undefined {
  return useRouterState({
    select: (s) => {
      const value = (s.location.search as { post?: string; entry?: string; article?: string })[key]
      return value
    },
  })
}

/**
 * The post, changelog entry and article modals any admin page opens from the
 * URL. They read the location and permissions themselves, so opening one (a
 * search-only navigation) renders them and not the layout around them. Each
 * opens its dialog at once and loads its content inside it (entity-modals.tsx).
 */
function EntityModals({
  currentUser,
}: {
  currentUser: ComponentProps<typeof PostModal>['currentUser'] | null
}) {
  const postId = useEntityIdFromUrl('post')
  const entryId = useEntityIdFromUrl('entry')
  const articleId = useEntityIdFromUrl('article')
  const onRoadmap = useRouterState({
    select: (s) =>
      s.location.pathname === '/admin/roadmap' || s.location.pathname.startsWith('/admin/roadmap/'),
  })
  const canViewChangelogDrafts = useHasPermission(PERMISSIONS.CHANGELOG_VIEW_DRAFT)
  const canManageHelpCenter = useHasPermission(PERMISSIONS.HELP_CENTER_MANAGE)
  const feedbackEnabled = useProductEnabled('feedback')
  const changelogEnabled = useProductEnabled('changelog')
  const helpCenterEnabled = useProductEnabled('helpCenter')

  return (
    <>
      {currentUser && feedbackEnabled && postId && !onRoadmap && (
        <PostModal postId={postId} currentUser={currentUser} />
      )}
      {changelogEnabled && canViewChangelogDrafts && entryId && (
        <ChangelogModal entryId={entryId} />
      )}
      {helpCenterEnabled && canManageHelpCenter && articleId && (
        <ArticleModal articleId={articleId} />
      )}
    </>
  )
}

/**
 * The first navigation after hydration reuses the guard this document was
 * rendered with instead of asking the server again. Each part is selected:
 * the route context is a new object after every navigation, the parts are not.
 */
function useSeedAdminGuard() {
  const user = Route.useRouteContext({ select: (context) => context.user })
  const principal = Route.useRouteContext({ select: (context) => context.principal })
  const permissions = Route.useRouteContext({ select: (context) => context.permissions })
  useEffect(() => {
    if (user && principal && permissions) adminGuard.seed({ user, principal, permissions })
  }, [user, principal, permissions])
}

function AdminLayout() {
  const {
    initialUserData,
    latestVersion,
    updateBannerDismissedVersion,
    planNotice,
    inLaunchWindow,
    currentUser,
    locale,
    messages,
  } = Route.useLoaderData()
  useSeedAdminGuard()
  useToasterLocale(locale)

  // Mark team members online for conversation routing across the whole admin (not just
  // the inbox), but only when the support inbox feature is on.
  const conversationsEnabled = useFeatureFlag('supportInbox')
  useAdminPresence(Boolean(initialUserData) && conversationsEnabled)

  // For public routes (login, signup), render just the outlet without the admin layout
  if (!initialUserData) {
    return <Outlet />
  }

  return (
    <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={messages}>
      <SearchPaletteProvider>
        <AdminProductTourProvider>
          <TooltipProvider delay={0}>
            <AdminContent
              initialUserData={initialUserData}
              latestVersion={latestVersion}
              updateBannerDismissedVersion={updateBannerDismissedVersion}
              planNotice={planNotice}
              inLaunchWindow={inLaunchWindow}
              currentUser={currentUser}
            />
          </TooltipProvider>
        </AdminProductTourProvider>
      </SearchPaletteProvider>
    </IntlProvider>
  )
}

function AdminContent({
  initialUserData,
  latestVersion,
  updateBannerDismissedVersion,
  planNotice,
  inLaunchWindow,
  currentUser,
}: Pick<
  ReturnType<typeof Route.useLoaderData>,
  | 'initialUserData'
  | 'latestVersion'
  | 'updateBannerDismissedVersion'
  | 'planNotice'
  | 'inLaunchWindow'
  | 'currentUser'
>) {
  // An open Home chat sits above the corner launcher's spot; the launcher steps aside.
  const canUseCopilot = useHasPermission(PERMISSIONS.COPILOT_USE)
  const chatOpen = useRouterState({
    select: (state) =>
      /^\/admin\/?$/.test(state.location.pathname) &&
      typeof (state.location.search as { copilotThread?: unknown }).copilotThread === 'string',
  })
  return (
    <>
      {/* In the launch window the corner launcher stays hidden (it reads like the
          workspace's own Messenger); Help, Contact us opens it. */}
      <CloudQuackbackWidget launcherHidden={inLaunchWindow || (canUseCopilot && chatOpen)} />
      <AdminWorkspaceFrame
        sidebar={
          initialUserData && (
            <AdminSidebar
              initialUserData={initialUserData}
              latestVersion={latestVersion}
              planNotice={planNotice}
            />
          )
        }
        notices={
          <>
            <PlanNoticeBanner notice={planNotice} />
            <UpdateBanner
              latestVersion={latestVersion}
              dismissedVersion={updateBannerDismissedVersion}
            />
          </>
        }
      >
        <FileViewerProvider onJumpToMessage={scrollToMessage}>
          <Outlet />
        </FileViewerProvider>
      </AdminWorkspaceFrame>
      <EntityModals currentUser={currentUser} />
    </>
  )
}

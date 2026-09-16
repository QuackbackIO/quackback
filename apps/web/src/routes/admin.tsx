import { Suspense, lazy } from 'react'
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
  useRouteContext,
} from '@tanstack/react-router'
import { IntlProvider } from 'react-intl'
import { useAdminPresence } from '@/lib/client/hooks/use-admin-presence'
import { DEFAULT_LOCALE, loadMessages } from '@/lib/shared/i18n'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { getLatestVersion, isNewerVersion } from '@/lib/server/functions/version'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UpdateBanner } from '@/components/admin/update-banner'
import { PlanNoticeBanner } from '@/components/admin/plan-notice-banner'
import { getPlanNotice } from '@/lib/server/functions/plan-notice'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { CloudQuackbackWidget } from '@/components/shared/cloud-quackback-widget'

const PostModal = lazy(() =>
  import('@/components/admin/feedback/post-modal').then((m) => ({ default: m.PostModal }))
)

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ location }) => {
    // Skip auth for public admin routes (login, signup)
    // These are child routes but should be publicly accessible
    const publicPaths = ['/admin/login', '/admin/signup']
    if (publicPaths.includes(location.pathname)) {
      return {}
    }

    // Only team members (admin, member roles) can access admin dashboard
    // Portal users (role='user') don't have access to this
    const [{ requireWorkspaceRole }, { shouldLockAdminToBillingFn }] = await Promise.all([
      import('@/lib/server/functions/workspace-utils'),
      import('@/lib/server/functions/billing'),
    ])
    // Role guard first: it throws a sign-in redirect. The billing helper's
    // requireAuth() throws a plain Error, so racing the two can surface an
    // error page for an unauthenticated visitor.
    const { user, principal, permissions } = await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'] },
    })
    if (await shouldLockAdminToBillingFn({ data: { pathname: location.pathname } })) {
      throw redirect({ href: '/admin/settings/billing' })
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
        locale: DEFAULT_LOCALE,
        messages: await loadMessages(DEFAULT_LOCALE),
      }
    }

    // Auth is already validated in beforeLoad - user and principal are guaranteed here
    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
    }

    const locale = context.acceptLanguageLocale ?? DEFAULT_LOCALE
    const [avatarData, latestRelease, planNotice, messages] = await Promise.all([
      fetchUserAvatar({
        data: { userId: user.id, fallbackImageUrl: user.image },
      }),
      getLatestVersion(),
      getPlanNotice(),
      loadMessages(locale),
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
  // Promise.all on every child route change. beforeLoad still runs each nav to
  // re-assert the auth guard.
  staleTime: 5 * 60 * 1000,
  component: AdminLayout,
})

function PostModalChunkFallback() {
  const navigate = useNavigate()
  const { pathname, search } = useRouterState({ select: (s) => s.location })
  const close = () => {
    const { post: _post, ...rest } = search as Record<string, unknown>
    void navigate({ to: pathname, search: rest, replace: true })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex h-[85vh] w-[95vw] flex-col gap-0 p-0 sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl">
        <DialogTitle className="sr-only">Edit post</DialogTitle>
        <div className="flex h-full flex-col gap-3 p-6">
          <Skeleton className="h-8 w-1/3 rounded-md" />
          <Skeleton className="min-h-0 flex-1 rounded-lg" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function usePostIdFromUrl(): string | undefined {
  return useRouterState({
    select: (s) => {
      const { post } = s.location.search as { post?: string }
      return post
    },
  })
}

function AdminLayout() {
  const {
    initialUserData,
    latestVersion,
    updateBannerDismissedVersion,
    planNotice,
    currentUser,
    locale,
    messages,
  } = Route.useLoaderData()
  const postId = usePostIdFromUrl()

  // Mark team members online for conversation routing across the whole admin (not just
  // the inbox), but only when the support inbox feature is on.
  const { settings } = useRouteContext({ from: '__root__' })
  const conversationsEnabled =
    (settings?.featureFlags as { supportInbox?: boolean } | undefined)?.supportInbox ?? false
  const feedbackEnabled = isProductEnabled(settings?.featureFlags, 'feedback')
  useAdminPresence(Boolean(initialUserData) && conversationsEnabled)

  // For public routes (login, signup), render just the outlet without the admin layout
  if (!initialUserData) {
    return <Outlet />
  }

  return (
    <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={messages}>
      <CloudQuackbackWidget />
      <TooltipProvider delay={0}>
        <div className="flex h-screen bg-background">
          <AdminSidebar initialUserData={initialUserData} latestVersion={latestVersion} />
          <main
            data-admin-shell=""
            className="flex-1 min-w-0 overflow-hidden sm:h-screen sm:py-2 sm:pr-2 sm:pl-1 p-0"
          >
            {/* Mobile: Add padding for fixed header */}
            <div
              data-admin-canvas=""
              className="h-full sm:pt-0 pt-14 sm:rounded-lg sm:border sm:border-border overflow-hidden flex flex-col"
            >
              <PlanNoticeBanner notice={planNotice} />
              <UpdateBanner
                latestVersion={latestVersion}
                dismissedVersion={updateBannerDismissedVersion}
              />
              <div className="flex-1 min-h-0 overflow-hidden">
                <Outlet />
              </div>
            </div>
          </main>
          {currentUser && feedbackEnabled && postId && (
            <Suspense fallback={<PostModalChunkFallback />}>
              <PostModal postId={postId} currentUser={currentUser} />
            </Suspense>
          )}
        </div>
      </TooltipProvider>
    </IntlProvider>
  )
}

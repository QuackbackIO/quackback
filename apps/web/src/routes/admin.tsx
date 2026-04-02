import { Suspense } from 'react'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { getLatestVersion, isNewerVersion } from '@/lib/server/functions/version'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { PostModal } from '@/components/admin/feedback/post-modal'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UpdateBanner } from '@/components/admin/update-banner'

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
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    const { user, principal } = await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'] },
    })

    return {
      user,
      principal,
    }
  },
  loader: async ({ context, location }) => {
    // Skip for public admin routes (login, signup) - they have their own layouts
    const publicPaths = ['/admin/login', '/admin/signup']
    if (publicPaths.includes(location.pathname)) {
      return { user: null, initialUserData: null, latestVersion: null, currentUser: null }
    }

    // Auth is already validated in beforeLoad - user and principal are guaranteed here
    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
    }

    const [avatarData, latestRelease] = await Promise.all([
      fetchUserAvatar({
        data: { userId: user.id, fallbackImageUrl: user.image },
      }),
      getLatestVersion(),
    ])

    const latestVersion =
      latestRelease && isNewerVersion(__APP_VERSION__, latestRelease.version) ? latestRelease : null

    const initialUserData = {
      name: user.name,
      email: user.email,
      avatarUrl: avatarData.avatarUrl,
    }

    return {
      user,
      initialUserData,
      latestVersion,
      currentUser: {
        name: user.name,
        email: user.email,
        principalId: principal.id,
      },
    }
  },
  component: AdminLayout,
})

function usePostIdFromUrl(): string | undefined {
  return useRouterState({
    select: (s) => {
      const { post } = s.location.search as { post?: string }
      return post
    },
  })
}

function AdminLayout() {
  const { initialUserData, latestVersion, currentUser } = Route.useLoaderData()
  const postId = usePostIdFromUrl()

  // For public routes (login, signup), render just the outlet without the admin layout
  if (!initialUserData) {
    return <Outlet />
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen bg-background">
        <AdminSidebar initialUserData={initialUserData} latestVersion={latestVersion} />
        <main className="flex-1 min-w-0 overflow-hidden sm:h-screen sm:py-2 sm:pr-2 sm:pl-1 p-0">
          {/* Mobile: Add padding for fixed header */}
          <div className="h-full sm:pt-0 pt-14 sm:rounded-lg sm:border sm:border-border overflow-hidden flex flex-col">
            <UpdateBanner latestVersion={latestVersion} />
            <div className="flex-1 min-h-0 overflow-hidden">
              <Outlet />
            </div>
          </div>
        </main>
        {currentUser && (
          <Suspense>
            <PostModal postId={postId} currentUser={currentUser} />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  )
}

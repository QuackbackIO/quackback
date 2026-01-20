import { createFileRoute, Outlet } from '@tanstack/react-router'
import { fetchUserAvatar } from '@/lib/server-functions/portal'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

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
    const { requireWorkspaceRole } = await import('@/lib/server-functions/workspace-utils')
    const { user, member } = await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'] },
    })

    return {
      user,
      member,
    }
  },
  loader: async ({ context, location }) => {
    // Skip for public admin routes (login, signup) - they have their own layouts
    const publicPaths = ['/admin/login', '/admin/signup']
    if (publicPaths.includes(location.pathname)) {
      return { user: null, initialUserData: null }
    }

    // Auth is already validated in beforeLoad - user is guaranteed to exist here
    const { user } = context as { user: NonNullable<typeof context.user> }

    // Get avatar URL with base64 data for SSR (no flicker)
    const avatarData = await fetchUserAvatar({
      data: { userId: user.id, fallbackImageUrl: user.image },
    })

    const initialUserData = {
      name: user.name,
      email: user.email,
      avatarUrl: avatarData.avatarUrl,
    }

    return {
      user,
      initialUserData,
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { initialUserData } = Route.useLoaderData()

  // For public routes (login, signup), render just the outlet without the admin layout
  if (!initialUserData) {
    return <Outlet />
  }

  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar initialUserData={initialUserData} />
      <main className="flex-1 min-w-0 overflow-hidden sm:h-screen sm:p-2 p-0">
        {/* Mobile: Add padding for fixed header */}
        <div className="h-full sm:pt-0 pt-14 sm:rounded-lg sm:border sm:border-border overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { fetchUserAvatar } from '@/lib/server-functions/portal'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    // Only team members (owner, admin, member roles) can access admin dashboard
    // Portal users don't have member records, so they can't access this
    const { requireWorkspaceRole } = await import('@/lib/server-functions/workspace-utils')
    const { user, member } = await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'] },
    })

    return {
      user,
      member,
    }
  },
  loader: async ({ context }) => {
    // Auth is already validated in beforeLoad
    const { user } = context

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

  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar initialUserData={initialUserData} />
      <main className="flex-1 min-w-0 overflow-hidden sm:h-screen">
        {/* Mobile: Add padding for fixed header */}
        <div className="h-full sm:pt-0 pt-14">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

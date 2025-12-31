import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireWorkspaceRole } from '@/lib/workspace'
import { AdminNav } from '@/components/admin/admin-nav'
import { getUserAvatarData } from '@/lib/avatar'

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ context: _context }) => {
    // Only team members (owner, admin, member roles) can access admin dashboard
    // Portal users don't have member records, so they can't access this
    // Settings is validated in root layout
    // Session is already available from root context
    const { user, member } = await requireWorkspaceRole(['owner', 'admin', 'member'])

    return {
      user,
      member,
    }
  },
  loader: async ({ context }) => {
    // Auth is already validated in beforeLoad
    // Session is available from root context
    const { user } = context

    // Get avatar URL with base64 data for SSR (no flicker)
    const avatarData = await getUserAvatarData(user.id, user.image)

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
    <div className="min-h-screen bg-background">
      <AdminNav initialUserData={initialUserData} />
      <Outlet />
    </div>
  )
}

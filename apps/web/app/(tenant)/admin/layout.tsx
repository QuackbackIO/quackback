import { requireTenantRole } from '@/lib/tenant'
import { AdminNav } from './admin-nav'
import { getUserAvatarData } from '@/lib/avatar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Only owner, admin, and member roles can access admin dashboard
  // Users with role='user' (portal users) are blocked
  const { user } = await requireTenantRole(['owner', 'admin', 'member'])

  // Get avatar URL with base64 data for SSR (no flicker)
  const avatarData = await getUserAvatarData(user.id, user.image)

  return (
    <div className="min-h-screen bg-background">
      <AdminNav userName={user.name} userEmail={user.email} userAvatarUrl={avatarData.avatarUrl} />
      {children}
    </div>
  )
}

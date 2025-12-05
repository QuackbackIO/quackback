import { requireTenantRole } from '@/lib/tenant'
import { AdminNav } from './admin-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { UserProfileProvider } from '@/components/providers/user-profile-provider'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Only owner, admin, and member roles can access admin dashboard
  // Users with role='user' (portal users) are blocked
  const { user } = await requireTenantRole(['owner', 'admin', 'member'])

  // Get avatar URL with base64 data for SSR (no flicker)
  const avatarData = await getUserAvatarData(user.id, user.image)

  const initialUserData = {
    name: user.name,
    email: user.email,
    avatarUrl: avatarData.avatarUrl,
  }

  return (
    <UserProfileProvider
      initialData={{
        ...initialUserData,
        hasCustomAvatar: avatarData.hasCustomAvatar,
      }}
    >
      <div className="min-h-screen bg-background">
        <AdminNav initialUserData={initialUserData} />
        {children}
      </div>
    </UserProfileProvider>
  )
}

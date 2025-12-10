import { requireTenantRoleBySlug } from '@/lib/tenant'
import { AdminNav } from './admin-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { UserProfileProvider } from '@/components/providers/user-profile-provider'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  // Only team members (owner, admin, member roles) can access admin dashboard
  // Portal users don't have member records, so they can't access this
  const { orgSlug } = await params
  const { user } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin', 'member'])

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

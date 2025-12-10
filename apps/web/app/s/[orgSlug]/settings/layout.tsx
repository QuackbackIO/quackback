import { requireTenantBySlug, getOrganizationBySlug, getCurrentUserRoleBySlug } from '@/lib/tenant'
import { PortalHeader } from '@/components/public/portal-header'
import { SettingsNav } from './settings-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { UserProfileProvider } from '@/components/providers/user-profile-provider'

interface SettingsLayoutProps {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function SettingsLayout({ children, params }: SettingsLayoutProps) {
  const { orgSlug } = await params

  // Allow ALL authenticated users (team members and portal users)
  const { user } = await requireTenantBySlug(orgSlug)
  const [org, userRole] = await Promise.all([
    getOrganizationBySlug(orgSlug),
    getCurrentUserRoleBySlug(orgSlug),
  ])

  if (!org) {
    return null
  }

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
      <div className="min-h-screen bg-background flex flex-col">
        <PortalHeader
          orgName={org.name}
          orgLogo={org.logo}
          userRole={userRole}
          initialUserData={initialUserData}
        />
        <div className="flex gap-8 px-6 py-8 max-w-5xl mx-auto w-full flex-1">
          <SettingsNav />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </UserProfileProvider>
  )
}

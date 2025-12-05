import { requireTenant, getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { PortalHeader } from '@/components/public/portal-header'
import { SettingsNav } from './settings-nav'
import { getUserAvatarData } from '@/lib/avatar'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // Allow ALL authenticated users (including portal users with role='user')
  const { user } = await requireTenant()
  const [org, userRole] = await Promise.all([getCurrentOrganization(), getCurrentUserRole()])

  if (!org) {
    return null
  }

  // Get avatar URL with base64 data for SSR (no flicker)
  const avatarData = await getUserAvatarData(user.id, user.image)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        orgName={org.name}
        orgLogo={org.logo}
        userRole={userRole}
        userName={user.name}
        userEmail={user.email}
        userAvatarUrl={avatarData.avatarUrl}
      />
      <div className="flex gap-8 px-6 py-8 max-w-5xl mx-auto w-full flex-1">
        <SettingsNav />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

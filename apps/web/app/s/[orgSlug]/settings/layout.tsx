import { requireTenantBySlug, getOrganizationBySlug, getCurrentUserRoleBySlug } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { SettingsNav } from './settings-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { getOrganizationLogoData } from '@/lib/organization'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { SessionProvider } from '@/components/providers/session-provider'

interface SettingsLayoutProps {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function SettingsLayout({ children, params }: SettingsLayoutProps) {
  const { orgSlug } = await params

  // Allow ALL authenticated users (team members and portal users)
  const { user } = await requireTenantBySlug(orgSlug)
  const [org, userRole, session] = await Promise.all([
    getOrganizationBySlug(orgSlug),
    getCurrentUserRoleBySlug(orgSlug),
    getSession(),
  ])

  if (!org) {
    return null
  }

  // Get avatar URL with base64 data for SSR (no flicker)
  // Get logo URL from blob storage for SSR
  const [avatarData, logoData] = await Promise.all([
    getUserAvatarData(user.id, user.image),
    getOrganizationLogoData(org.id),
  ])

  const initialUserData = {
    name: user.name,
    email: user.email,
    avatarUrl: avatarData.avatarUrl,
  }

  return (
    <SessionProvider initialSession={session}>
      <AuthPopoverProvider>
        <div className="min-h-screen bg-background flex flex-col">
          <PortalHeader
            orgName={org.name}
            orgLogo={logoData.logoUrl}
            userRole={userRole}
            initialUserData={initialUserData}
          />
          <div className="flex gap-8 px-6 py-8 max-w-5xl mx-auto w-full flex-1">
            <SettingsNav />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </AuthPopoverProvider>
    </SessionProvider>
  )
}

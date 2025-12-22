import { requireTenantRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { AdminNav } from './admin-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { SessionProvider } from '@/components/providers/session-provider'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { getWorkspaceFeatures } from '@/lib/features/server'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params?: Promise<{}>
}) {
  // Only team members (owner, admin, member roles) can access admin dashboard
  // Portal users don't have member records, so they can't access this
  // Settings is validated in root layout
  const [{ user, settings }, session] = await Promise.all([
    requireTenantRole( ['owner', 'admin', 'member']),
    getSession(),
  ])

  // Get features for SSR hydration
  const features = await getWorkspaceFeatures(settings.id)

  // Get avatar URL with base64 data for SSR (no flicker)
  const avatarData = await getUserAvatarData(user.id, user.image)

  const initialUserData = {
    name: user.name,
    email: user.email,
    avatarUrl: avatarData.avatarUrl,
  }

  return (
    <SessionProvider initialSession={session}>
      <FeaturesProvider
        workspaceId={settings.id}
        initialFeatures={{
          edition: features.edition,
          tier: features.tier,
          enabledFeatures: features.enabledFeatures,
          limits: features.limits,
        }}
      >
        <div className="min-h-screen bg-background">
          <AdminNav initialUserData={initialUserData} />
          {children}
        </div>
      </FeaturesProvider>
    </SessionProvider>
  )
}

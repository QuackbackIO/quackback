import { requireTenantRoleBySlug } from '@/lib/tenant'
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
  params: Promise<{ orgSlug: string }>
}) {
  // Only team members (owner, admin, member roles) can access admin dashboard
  // Portal users don't have member records, so they can't access this
  const { orgSlug } = await params
  const [{ user, workspace }, session] = await Promise.all([
    requireTenantRoleBySlug(orgSlug, ['owner', 'admin', 'member']),
    getSession(),
  ])

  // Get features for SSR hydration
  const features = await getWorkspaceFeatures(workspace.id)

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
        workspaceId={workspace.id}
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

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireWorkspaceRole } from '@/lib/workspace'
import { AdminNav } from '@/app/admin/admin-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { SessionProvider } from '@/components/providers/session-provider'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { getWorkspaceFeatures } from '@/lib/features/server'

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ context: _context }) => {
    // Only team members (owner, admin, member roles) can access admin dashboard
    // Portal users don't have member records, so they can't access this
    // Settings is validated in root layout
    // Session is already available from root context
    const { user } = await requireWorkspaceRole(['owner', 'admin', 'member'])

    return {
      user,
    }
  },
  loader: async ({ context }) => {
    // Auth is already validated in beforeLoad
    // Session is available from root context
    const { user, session } = context

    // Get features for SSR hydration
    const features = await getWorkspaceFeatures()

    // Get avatar URL with base64 data for SSR (no flicker)
    const avatarData = await getUserAvatarData(user.id, user.image)

    const initialUserData = {
      name: user.name,
      email: user.email,
      avatarUrl: avatarData.avatarUrl,
    }

    // Extract only serializable feature data (exclude hasFeature function)
    const serializableFeatures = {
      edition: features.edition,
      tier: features.tier,
      enabledFeatures: features.enabledFeatures,
      limits: features.limits,
    }

    return {
      user,
      session,
      features: serializableFeatures,
      initialUserData,
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { session, features, initialUserData } = Route.useLoaderData()

  return (
    <SessionProvider initialSession={session}>
      <FeaturesProvider
        initialFeatures={{
          edition: features.edition,
          tier: features.tier,
          enabledFeatures: features.enabledFeatures,
          limits: features.limits,
        }}
      >
        <div className="min-h-screen bg-background">
          <AdminNav initialUserData={initialUserData} />
          <Outlet />
        </div>
      </FeaturesProvider>
    </SessionProvider>
  )
}

import { requireTenantBySlug } from '@/lib/tenant'
import { db, user as userTable, eq } from '@/lib/db'
import { User } from 'lucide-react'
import { ProfileForm } from './profile-form'

interface ProfilePageProps {
  params: Promise<{ orgSlug: string }>
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { orgSlug } = await params
  const { user } = await requireTenantBySlug(orgSlug)

  // Fetch user's avatar data for SSR
  const userRecord = await db.query.user.findFirst({
    where: eq(userTable.id, user.id),
    columns: {
      imageBlob: true,
      imageType: true,
      image: true,
    },
  })

  const hasCustomAvatar = !!(userRecord?.imageBlob && userRecord?.imageType)
  // OAuth avatar URL (from GitHub, Google, etc.) - used as fallback
  const oauthAvatarUrl = userRecord?.image ?? null

  // Convert blob to base64 data URL for SSR - eliminates flicker
  // Custom blob avatar takes precedence over OAuth image URL
  let avatarUrl: string | null = null
  if (hasCustomAvatar && userRecord.imageBlob && userRecord.imageType) {
    const base64 = Buffer.from(userRecord.imageBlob).toString('base64')
    avatarUrl = `data:${userRecord.imageType};base64,${base64}`
  } else if (oauthAvatarUrl) {
    avatarUrl = oauthAvatarUrl
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information</p>
        </div>
      </div>

      <ProfileForm
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
        }}
        initialAvatarUrl={avatarUrl}
        oauthAvatarUrl={oauthAvatarUrl}
        hasCustomAvatar={hasCustomAvatar}
      />
    </div>
  )
}

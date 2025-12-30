import { createFileRoute } from '@tanstack/react-router'
import { requireWorkspace } from '@/lib/workspace'
import { fetchUserProfile } from '@/lib/server-functions/settings'
import { User } from 'lucide-react'
import { ProfileForm } from '@/app/(portal)/settings/profile/profile-form'

export const Route = createFileRoute('/_portal/settings/profile')({
  loader: async () => {
    // Workspace is validated in root layout
    const { user } = await requireWorkspace()

    const { avatarUrl, oauthAvatarUrl, hasCustomAvatar } = await fetchUserProfile(user.id)

    return {
      user,
      avatarUrl,
      oauthAvatarUrl,
      hasCustomAvatar,
    }
  },
  component: ProfilePage,
})

function ProfilePage() {
  const { user, avatarUrl, oauthAvatarUrl, hasCustomAvatar } = Route.useLoaderData()

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

import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { UserIcon } from '@heroicons/react/24/solid'
import { ProfileForm } from '@/components/settings/profile-form'

export const Route = createFileRoute('/_portal/settings/profile')({
  loader: async ({ context }) => {
    // Session and settings validated in parent _portal layout
    const { session, queryClient } = context

    if (!session?.user) {
      throw new Error('User not authenticated')
    }

    // Pre-fetch user profile using React Query
    await queryClient.ensureQueryData(settingsQueries.userProfile(session.user.id))

    return {
      user: session.user,
    }
  },
  component: ProfilePage,
})

function ProfilePage() {
  const { user } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const profileQuery = useSuspenseQuery(settingsQueries.userProfile(user.id))
  const { avatarUrl, oauthAvatarUrl, hasCustomAvatar } = profileQuery.data

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <UserIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information</p>
        </div>
      </div>

      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '75ms' }}
      >
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
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { UserIcon } from '@heroicons/react/24/solid'
import { PageHeader } from '@/components/shared/page-header'
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

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserIcon}
        title="Profile"
        description="Manage your personal information"
        animate
      />

      <div
        className="animate-in fade-in duration-200 fill-mode-backwards"
        style={{ animationDelay: '75ms' }}
      >
        <ProfileForm
          user={{
            id: user.id,
            name: user.name,
            email: user.email,
          }}
        />
      </div>
    </div>
  )
}

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import { settingsQueries } from '@/lib/client/queries/settings'
import { getEmailChangeStateFn } from '@/lib/server/functions/contact-email'
import { UserIcon } from '@heroicons/react/24/solid'
import { PageHeader } from '@/components/shared/page-header'
import { ProfileForm } from '@/components/settings/profile-form'
import { TwoFactorSection } from '@/components/settings/two-factor-section'

export const Route = createFileRoute('/_portal/settings/profile')({
  loader: async ({ context }) => {
    // Session and settings validated in parent _portal layout
    const { session, queryClient } = context

    if (!session?.user) {
      throw new Error('User not authenticated')
    }

    // Pre-fetch user profile and the email-change widget's own state
    // together: both are needed for this page's first paint, so seeding
    // them here (same query key EmailField already reads) turns what would
    // be a separate post-hydration round trip, redoing the session/principal
    // lookup this loader already paid for, into one shell response.
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.userProfile(session.user.id)),
      queryClient.ensureQueryData({
        queryKey: ['email-change-state'],
        queryFn: () => getEmailChangeStateFn(),
      }),
    ])

    return {
      user: session.user,
    }
  },
  component: ProfilePage,
})

function ProfilePage() {
  const intl = useIntl()
  const router = useRouter()
  const { user } = Route.useLoaderData()
  const { data: userProfile } = useSuspenseQuery(settingsQueries.userProfile(user.id as UserId))

  // 2FA only gates password sign-ins, so the section is only meaningful
  // when the user actually has a password (and isn't SSO-bound — those
  // users have their MFA enforced at the IdP).
  const showTwoFactor = userProfile.hasPassword && !userProfile.ssoEnforced

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserIcon}
        title={intl.formatMessage({
          id: 'portal.settings.profile.title',
          defaultMessage: 'Profile',
        })}
        description={intl.formatMessage({
          id: 'portal.settings.profile.description',
          defaultMessage: 'Manage your personal information',
        })}
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

      {showTwoFactor && (
        <div
          className="animate-in fade-in duration-200 fill-mode-backwards rounded-xl border border-border/50 bg-card p-6 shadow-sm"
          style={{ animationDelay: '100ms' }}
        >
          <TwoFactorSection
            enrolled={userProfile.twoFactorEnabled === true}
            onChanged={() => router.invalidate()}
          />
        </div>
      )}

      {userProfile.ssoEnforced && (
        <div
          className="animate-in fade-in duration-200 fill-mode-backwards rounded-xl border border-border/50 bg-muted/20 p-6"
          style={{ animationDelay: '100ms' }}
        >
          <h2 className="font-medium">Managed by your identity provider</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your password and two-factor authentication are handled by your organization&apos;s
            single sign-on. Change them where you normally sign in.
          </p>
        </div>
      )}
    </div>
  )
}

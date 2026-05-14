import { createFileRoute, Link } from '@tanstack/react-router'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/auth/two-factor-setup-required')({
  component: TwoFactorSetupRequiredPage,
})

/**
 * Landing page for team-role users whose workspace requires 2FA but
 * who haven't enrolled yet. Magic-link is the break-glass: the user
 * signs in via magic-link, lands in the user-profile 2FA section,
 * enrolls, then password sign-in starts working again.
 *
 * Reached from `hooksBefore` when:
 *   - `authConfig.twoFactor.required === true`
 *   - the principal role is `admin` or `member`
 *   - `user.twoFactorEnabled !== true`
 */
function TwoFactorSetupRequiredPage() {
  return (
    <div className="mx-auto mt-16 max-w-md space-y-6 p-6">
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheckIcon className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">Two-factor authentication required</h1>
        <p className="text-sm text-muted-foreground">
          Your workspace requires team members to set up two-factor authentication before signing in
          with a password. Use a one-time magic link to get back in, then enroll an authenticator
          from your profile.
        </p>
      </div>
      <Button asChild className="w-full">
        <Link to="/admin/login">Continue with magic link</Link>
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already enrolled? Sign in again to enter your code.
      </p>
    </div>
  )
}

/**
 * Connection-test capstone for the connection card: one "Test sign-in" action
 * plus a status line reflecting whether the connection is verified, never
 * tested, or stale since the last config change. A fresh successful test is
 * what unlocks SSO enforcement, so the row names that payoff.
 */
import { CheckCircleIcon, ClockIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { TimeAgo } from '@/components/ui/time-ago'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { getConnectionTestState } from './provider-shared'

export function ConnectionTestRow({
  provider,
  registrationId,
  disabled,
}: {
  provider: IdentityProvider | null
  registrationId: string
  disabled: boolean
}) {
  const state = getConnectionTestState(provider)
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <Label className="font-medium">Connection</Label>
        <div className="mt-1 text-xs">
          {state.kind === 'unsaved' && (
            <span className="text-muted-foreground">
              Save the provider first, then sign in through it to verify the connection.
            </span>
          )}
          {state.kind === 'untested' && (
            <span className="text-muted-foreground">
              Not tested yet. Sign in through this provider to verify it. Required before you can
              enforce SSO.
            </span>
          )}
          {state.kind === 'verified' && (
            <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
              <CheckCircleIcon className="size-3.5 shrink-0" />
              Verified <TimeAgo date={state.testedAt} />, ready to enforce SSO.
            </span>
          )}
          {state.kind === 'stale' && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <ClockIcon className="size-3.5 shrink-0" />
              Connection changed since the last test. Re-test to enforce SSO.
            </span>
          )}
        </div>
      </div>
      <TestSignInButton registrationId={registrationId} disabled={disabled || !provider} />
    </div>
  )
}

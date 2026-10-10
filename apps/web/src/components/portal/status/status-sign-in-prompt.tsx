import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { isStatusPagePublished } from '@/lib/shared/status-settings'

/**
 * Whether signing in could open a status page this visitor was turned away
 * from: the page is published for signed-in visitors (everyone, or chosen
 * segments) and this visitor isn't signed in. Anything else (an unpublished
 * page, a public one, a signed-in visitor outside the segments) is a plain
 * "not available".
 */
export function useStatusSignInCouldGrantAccess(): boolean {
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const signedIn = !!session?.user && session.user.principalType !== 'anonymous'
  const audience = settings?.statusConfig?.audience ?? 'public'
  return (
    !signedIn &&
    audience !== 'public' &&
    isStatusPagePublished(settings?.featureFlags, settings?.statusConfig)
  )
}

/** The status page's "sign in to see it" message, in place of "not available". */
export function StatusSignInPrompt() {
  const intl = useIntl()
  const authPopover = useAuthPopoverSafe()

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">
        {intl.formatMessage({
          id: 'portal.status.signInRequired.title',
          defaultMessage: 'Sign in to view status',
        })}
      </h1>
      <p className="mb-6 text-muted-foreground">
        {intl.formatMessage({
          id: 'portal.status.signInRequired.description',
          defaultMessage: 'You need to sign in to see this status page.',
        })}
      </p>
      {authPopover && (
        <Button
          onClick={() =>
            // An SSO redirect brings the visitor back to this page, not home.
            authPopover.openAuthPopover({ mode: 'login', callbackUrl: window.location.pathname })
          }
        >
          {intl.formatMessage({
            id: 'portal.status.signInRequired.cta',
            defaultMessage: 'Sign in',
          })}
        </Button>
      )}
    </>
  )
}

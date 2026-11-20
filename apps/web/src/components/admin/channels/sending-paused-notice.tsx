/**
 * A notice on the email settings while the email provider has paused this
 * workspace's sending: why, who can lift it, and what still works (sign-in and
 * security email never sends under the workspace's own reputation). Nothing at
 * all while mail sends.
 */
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function SendingPausedNotice({
  paused,
  ownServer = false,
}: {
  paused: { cause: string | null } | null
  /** One workspace on its own server, whose administrator holds the provider account. */
  ownServer?: boolean
}) {
  if (!paused) return null
  return (
    <Alert>
      <ExclamationTriangleIcon />
      <AlertDescription>
        Sending is paused by the email provider because of bounces or complaints.
        {paused.cause ? ` ${paused.cause}` : null}{' '}
        {ownServer
          ? 'Your administrator can resume it with the provider.'
          : 'Contact support to resume.'}{' '}
        Sign-in email is not affected.
      </AlertDescription>
    </Alert>
  )
}

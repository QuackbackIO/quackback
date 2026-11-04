/**
 * One line on the email settings while the email provider has paused this
 * workspace's sending. Nothing at all while mail sends.
 */
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function SendingPausedNotice({ paused }: { paused: { cause: string | null } | null }) {
  if (!paused) return null
  return (
    <Alert>
      <ExclamationTriangleIcon />
      <AlertDescription>
        Sending is paused by the email provider because of bounces or complaints.
        {paused.cause ? ` ${paused.cause}` : null}
      </AlertDescription>
    </Alert>
  )
}

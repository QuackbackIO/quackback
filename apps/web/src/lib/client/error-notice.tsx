/**
 * The one way to toast a failed call (`errorText` in error-text.ts is its twin
 * for a line under a form). Worded through `describeError`, so a raw
 * technical message never reaches the screen.
 */
import { toast } from 'sonner'
import { describeError } from '@/lib/shared/describe-error'
import { errorAudience } from '@/lib/client/error-text'

/**
 * Shows a failed call as an error toast. `fallback` names what did not happen
 * ("Couldn't create roadmap") and is used whenever the error has no message
 * written for people.
 */
export function toastError(error: unknown, fallback: string): void {
  const notice = describeError(error, fallback, errorAudience())
  if (!notice.description && !notice.action) {
    toast.error(notice.title)
    return
  }

  const { reference } = notice
  toast.error(notice.title, {
    description: reference ? (
      <>
        {notice.description}
        <span className="mt-1 block font-mono text-xs opacity-70">Ref {reference}</span>
      </>
    ) : (
      notice.description
    ),
    action:
      notice.action === 'reload'
        ? { label: 'Reload', onClick: () => window.location.reload() }
        : notice.action === 'sign-in'
          ? { label: 'Sign in', onClick: () => window.location.assign('/admin/login') }
          : reference
            ? { label: 'Copy', onClick: () => void navigator.clipboard?.writeText(reference) }
            : undefined,
  })
}

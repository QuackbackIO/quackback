import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'

interface ErrorPageProps {
  error: Error
  reset?: () => void
  fullPage?: boolean
}

interface FriendlyShellProps {
  children: React.ReactNode
  fullPage?: boolean
}

export function FriendlyShell({ children, fullPage = true }: FriendlyShellProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center px-4',
        fullPage ? 'min-h-screen' : 'min-h-[400px]'
      )}
    >
      <div className="w-full max-w-md text-center">
        <img src="/logo.png" alt="Quackback" className="mx-auto mb-6 h-16 w-16" />
        {children}
      </div>
    </div>
  )
}

/**
 * True for the role-gate failures thrown by requireAuth / requireWorkspaceRole
 * (e.g. "Access denied: Requires [admin], got member"). These are expected
 * outcomes, not crashes, so they get a calm permission notice rather than the
 * scary generic error treatment.
 */
export function isAuthorizationError(error: Error): boolean {
  return /access denied/i.test(error.message)
}

export function PermissionDeniedPage({ fullPage = true }: { fullPage?: boolean }) {
  // Teammates who bounce off an admin-only page get a path back to their work
  // surfaces; portal visitors get the public exit (for them "Back to Feedback"
  // would just be denied again). Error boundaries can render outside router
  // context, so read the path from the window rather than a router hook.
  const isAdminArea = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')

  return (
    <FriendlyShell fullPage={fullPage}>
      <h1 className="text-2xl font-semibold tracking-tight">You don&apos;t have access</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Only people with the right permissions can open this page. Ask a workspace admin if you need
        access.
      </p>

      <div className="mt-6 flex items-center justify-center gap-3">
        {isAdminArea ? (
          <>
            <Button asChild>
              <a href="/admin/feedback">Back to Feedback</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/">View public board</a>
            </Button>
          </>
        ) : (
          <Button variant="outline" asChild>
            <a href="/">Go home</a>
          </Button>
        )}
      </div>
    </FriendlyShell>
  )
}

export function DefaultErrorPage({ error, reset, fullPage = true }: ErrorPageProps) {
  if (isAuthorizationError(error)) {
    return <PermissionDeniedPage fullPage={fullPage} />
  }

  return (
    <FriendlyShell fullPage={fullPage}>
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        An unexpected error occurred. Try again, or return to the home page.
      </p>

      {error.message && (
        <details className="mt-4 rounded-md border bg-muted/40 px-4 py-3 text-left">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Technical details
          </summary>
          <p className="mt-2 break-words text-sm text-muted-foreground">{error.message}</p>
        </details>
      )}

      <div className="mt-6 flex items-center justify-center gap-3">
        {reset && (
          <Button onClick={reset} variant="default">
            Try again
          </Button>
        )}
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
      </div>
    </FriendlyShell>
  )
}

export function NotFoundPage() {
  return (
    <FriendlyShell>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you're looking for doesn't exist. It may have been moved or deleted, or the link
        may be incorrect.
      </p>

      <div className="mt-6">
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
      </div>
    </FriendlyShell>
  )
}

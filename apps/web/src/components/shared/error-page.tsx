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

export function DefaultErrorPage({ error, reset, fullPage = true }: ErrorPageProps) {
  return (
    <FriendlyShell fullPage={fullPage}>
      <h1 className="text-2xl font-semibold tracking-tight">Quack! Something tripped us up.</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        An unexpected error got in the way. Try again, or head back to the home page — usually one
        of those does the trick.
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
      <h1 className="text-2xl font-semibold tracking-tight">That page has flown the pond.</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn't find what you were looking for. It may have been moved, or the link might be
        wrong.
      </p>

      <div className="mt-6">
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
      </div>
    </FriendlyShell>
  )
}

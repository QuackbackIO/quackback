/**
 * Shared route-level error boundary for admin routes. Wire into a route via
 * `errorComponent: createRouteErrorComponent('Failed to load …')`.
 */
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ExclamationCircleIcon } from '@heroicons/react/24/outline'

export interface RouteErrorBoundaryProps {
  error: Error
  reset: () => void
  title?: string
}

export function RouteErrorBoundary({
  error,
  reset,
  title = 'Something went wrong',
}: RouteErrorBoundaryProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <ExclamationCircleIcon className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{error.message}</p>
          <Button onClick={reset} variant="outline" size="sm">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

/**
 * Convenience factory: returns a TanStack Router `errorComponent` bound to a
 * specific title.
 */
export function createRouteErrorComponent(title: string) {
  return function BoundRouteErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
    return <RouteErrorBoundary error={error} reset={reset} title={title} />
  }
}

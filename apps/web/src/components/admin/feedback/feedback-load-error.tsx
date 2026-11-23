import { useRouter } from '@tanstack/react-router'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/components/shared/error-page'

/** The feedback inbox's route error: says what failed and offers Try again. */
export function FeedbackLoadError({ error, reset }: { error: unknown; reset: () => void }) {
  const message = errorMessage(error)
  const router = useRouter()
  // Resetting the boundary alone re-renders the same failed loader result;
  // invalidating re-runs the loader, so Try again actually tries again.
  const retry = () => {
    void router.invalidate()
    reset()
  }
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <ExclamationCircleIcon className="h-4 w-4" />
        <AlertTitle>Failed to load feedback</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{message}</p>
          <Button onClick={retry} variant="outline" size="sm">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

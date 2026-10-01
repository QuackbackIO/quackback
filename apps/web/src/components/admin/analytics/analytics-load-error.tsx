import { Button } from '@/components/ui/button'

/** A failed analytics query: what could not be loaded, with a retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

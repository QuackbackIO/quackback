import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Spinner } from '@/components/shared/spinner'
import { acceptInvitationFn } from '@/lib/server/functions/invitations'

export const Route = createFileRoute('/accept-invitation/$id')({
  loader: async ({ params, context }) => {
    const { id } = params
    const { session } = context

    // With magic links, users are authenticated before reaching this page.
    // The magic link verification creates a session and redirects here.
    if (!session?.user) {
      return { error: 'Please use the invitation link from your email to join the team.' }
    }

    // User is authenticated - accept the invitation immediately
    try {
      await acceptInvitationFn({ data: id })
      // Success - redirect directly to admin dashboard
      throw redirect({ to: '/admin' })
    } catch (error) {
      // Don't treat redirect as an error
      if (error instanceof Response || (error as { status?: number })?.status === 302) {
        throw error
      }
      const message = error instanceof Error ? error.message : 'Failed to accept invitation'
      return { error: message }
    }
  },
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const data = Route.useLoaderData()
  const [retrying, setRetrying] = useState(false)

  // If we reach this component, there was an error (success redirects in loader)
  const error = data?.error || 'An unexpected error occurred'

  const handleRetry = () => {
    setRetrying(true)
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md text-center px-4">
        {retrying ? (
          <div>
            <Spinner size="xl" className="border-primary mx-auto" />
            <p className="mt-4 text-muted-foreground">Retrying...</p>
          </div>
        ) : (
          <div>
            <div className="text-destructive text-xl font-medium">Unable to accept invitation</div>
            <p className="mt-2 text-muted-foreground">{error}</p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={handleRetry}
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
              <a
                href="/"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Go to Home
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

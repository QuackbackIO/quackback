import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { acceptInvitationFn } from '@/lib/server-functions/invitations'

export const Route = createFileRoute('/accept-invitation/$id')({
  loader: async ({ params, context }) => {
    const { id } = params
    const { session } = context

    console.log('[accept-invitation] loader called', {
      id,
      hasSession: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.id,
    })

    // If not authenticated, redirect to signup with invitation ID
    if (!session || !session.user) {
      console.log('[accept-invitation] redirecting to signup', { invitation: id })
      throw redirect({
        to: '/admin/signup',
        search: { invitation: id },
      })
    }

    console.log('[accept-invitation] user authenticated, proceeding')
    // User is authenticated - return the invitation ID for the component to process
    return { invitationId: id }
  },
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const { invitationId } = Route.useLoaderData()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    async function accept() {
      try {
        // Accept the invitation - this will upgrade portal users to team members
        await acceptInvitationFn({ data: invitationId })
        setStatus('success')
        // Redirect to admin dashboard after a short delay
        setTimeout(() => {
          window.location.href = '/admin'
        }, 2000)
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to accept invitation')
      }
    }

    accept()
  }, [invitationId])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md text-center px-4">
        {status === 'loading' && (
          <div>
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="mt-4 text-muted-foreground">Accepting invitation...</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <div className="text-primary text-xl font-medium">Welcome to the team!</div>
            <p className="mt-2 text-muted-foreground">Redirecting to dashboard...</p>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="text-destructive text-xl font-medium">Unable to accept invitation</div>
            <p className="mt-2 text-muted-foreground">{error}</p>
            <a href="/admin/login" className="mt-4 text-primary underline block">
              Go to login
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useSession } from '@/lib/auth/client'
import { acceptInvitationAction } from '@/lib/actions/invitations'
import { getProfileAction } from '@/lib/actions/user'

export const Route = createFileRoute('/accept-invitation/$id')({
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const { id } = Route.useParams()
  const router = useRouter()
  const sessionQuery = useSession()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    // Wait for session to load
    if (sessionQuery.isPending) return

    async function accept() {
      const session = sessionQuery.data as any
      // Check if user is authenticated
      if (!session || !session.user) {
        // Redirect to admin signup with invitation ID
        // New users can create an account and accept the invitation in one step
        router.navigate({
          to: '/admin/signup',
          search: { invitation: id },
        })
        return
      }

      try {
        // Check if user is a portal user (portal users can't accept team invitations)
        const profileResult = await getProfileAction()
        if (profileResult.success && profileResult.data.userType === 'portal') {
          throw new Error(
            'Portal users cannot accept team invitations. Please sign up with a team account or contact your administrator.'
          )
        }

        const result = await acceptInvitationAction({ data: id })

        if (!result.success) {
          throw new Error(result.error || 'Failed to accept invitation')
        }

        setStatus('success')
        // Redirect to admin dashboard after a short delay
        setTimeout(() => router.navigate({ to: '/admin' }), 2000)
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to accept invitation')
      }
    }

    accept()
  }, [id, sessionQuery.data, sessionQuery.isPending, router])

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
            <button
              onClick={() => router.navigate({ to: '/admin/login' })}
              className="mt-4 text-primary underline"
            >
              Go to login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

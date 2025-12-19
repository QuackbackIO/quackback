'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { acceptInvitationAction } from '@/lib/actions/invitations'

export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { data: session, isPending } = useSession()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    // Wait for session to load
    if (isPending) return

    async function accept() {
      if (!session?.user) {
        // Redirect to admin signup with invitation ID
        // New users can create an account and accept the invitation in one step
        router.push(`/admin/signup?invitation=${id}`)
        return
      }

      try {
        // Check if user is a portal user (portal users can't accept team invitations)
        const profileRes = await fetch('/api/user/profile')
        if (profileRes.ok) {
          const profile = await profileRes.json()
          if (profile.userType === 'portal') {
            throw new Error(
              'Portal users cannot accept team invitations. Please sign up with a team account or contact your administrator.'
            )
          }
        }

        const result = await acceptInvitationAction(id)

        if (!result.success) {
          throw new Error(result.error || 'Failed to accept invitation')
        }

        setStatus('success')
        // Redirect to admin dashboard after a short delay
        setTimeout(() => router.push('/admin'), 2000)
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to accept invitation')
      }
    }

    accept()
  }, [id, session, isPending, router])

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
              onClick={() => router.push('/admin/login')}
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

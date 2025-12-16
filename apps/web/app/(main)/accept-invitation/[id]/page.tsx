'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvitation, useSession } from '@/lib/auth/client'

export default function AcceptInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    async function accept() {
      if (!session?.user) {
        router.push(`/login?callbackUrl=/accept-invitation/${id}`)
        return
      }

      try {
        // Check if user is a portal user (portal users can't accept team invitations)
        const profileRes = await fetch('/api/user/profile')
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { userType?: string }
          if (profile.userType === 'portal') {
            throw new Error(
              'Portal users cannot accept team invitations. Please contact your administrator to be invited as a team member.'
            )
          }
        }

        const { error: acceptError } = await acceptInvitation({
          invitationId: id,
        })

        if (acceptError) {
          throw new Error(acceptError.message)
        }

        setStatus('success')
        setTimeout(() => router.push('/admin'), 2000)
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to accept invitation')
      }
    }

    accept()
  }, [id, session, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md text-center px-4">
        {status === 'loading' && (
          <div>
            <div className="animate-spin h-8 w-8 border-2 border-foreground border-t-transparent rounded-full mx-auto" />
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
              onClick={() => router.push('/login')}
              className="mt-4 text-foreground underline"
            >
              Go to login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

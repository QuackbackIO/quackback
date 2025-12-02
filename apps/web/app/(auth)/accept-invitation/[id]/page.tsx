'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvitation, useSession } from '@/lib/auth/client'

export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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
            <div className="animate-spin h-8 w-8 border-2 border-gray-900 border-t-transparent rounded-full mx-auto" />
            <p className="mt-4 text-gray-600">Accepting invitation...</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <div className="text-green-600 text-xl font-medium">
              Welcome to the team!
            </div>
            <p className="mt-2 text-gray-600">Redirecting to dashboard...</p>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="text-red-600 text-xl font-medium">
              Unable to accept invitation
            </div>
            <p className="mt-2 text-gray-600">{error}</p>
            <button
              onClick={() => router.push('/login')}
              className="mt-4 text-black underline"
            >
              Go to login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

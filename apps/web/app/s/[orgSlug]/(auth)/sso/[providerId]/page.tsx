'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth/client'
import { Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

/**
 * Direct SSO login page
 *
 * Allows users to bookmark or link directly to SSO login:
 * /sso/{providerId}?callbackUrl=/admin
 *
 * Useful for:
 * - Corporate portal links
 * - SSO-only organizations
 * - Bookmarking
 */
export default function DirectSsoLoginPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const providerId = params.providerId as string
  const callbackUrl = searchParams.get('callbackUrl') || '/admin'

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function initiateSsoLogin() {
      try {
        await signIn.sso({
          providerId,
          callbackURL: callbackUrl,
        })
        // If we get here without redirect, something went wrong
        setError('SSO login failed to redirect')
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'SSO login failed')
        setLoading(false)
      }
    }

    if (providerId) {
      initiateSsoLogin()
    }
  }, [providerId, callbackUrl])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Redirecting to SSO provider...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md space-y-6 px-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">SSO Login Failed</h1>
            <p className="mt-2 text-muted-foreground">{error}</p>
          </div>
          <div className="space-y-2">
            <Button asChild className="w-full">
              <Link href="/login">Back to Login</Link>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setLoading(true)
                setError(null)
                signIn.sso({ providerId, callbackURL: callbackUrl }).catch((err) => {
                  setError(err instanceof Error ? err.message : 'SSO login failed')
                  setLoading(false)
                })
              }}
            >
              Try Again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

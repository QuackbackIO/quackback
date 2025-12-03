'use client'

import { useState } from 'react'
import { signIn } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Loader2, KeyRound } from 'lucide-react'

interface SsoLoginButtonProps {
  providerId: string
  issuer: string
  callbackUrl?: string
}

export function SsoLoginButton({ providerId, issuer, callbackUrl }: SsoLoginButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSsoLogin() {
    setLoading(true)
    setError(null)

    try {
      await signIn.sso({
        providerId,
        callbackURL: callbackUrl || '/admin',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSO login failed')
      setLoading(false)
    }
    // Note: If successful, the page will redirect, so we don't need to setLoading(false)
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleSsoLogin} variant="outline" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Sign in with {issuer}
      </Button>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
    </div>
  )
}

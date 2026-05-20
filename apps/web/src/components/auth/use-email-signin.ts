import { useEffect, useState } from 'react'
import { authClient } from '@/lib/client/auth-client'

interface UseEmailSigninOptions {
  /** Where the magic link should land after a successful click. */
  callbackUrl: string
  /** Called after a successful OTP verification. */
  onSuccess: () => void | Promise<void>
}

interface UseEmailSigninResult {
  loading: boolean
  error: string
  code: string
  setCode: (code: string) => void
  /** Trigger the sign-in email send (POST /api/auth/portal-signin). */
  requestEmail: (email: string) => Promise<{ ok: boolean; error?: string }>
  /** Verify a 6-digit code; calls onSuccess on success. Idempotent if already loading. */
  verify: (email: string, otp: string) => Promise<void>
  /** Re-send the email; share the request flow. */
  resend: (email: string) => Promise<void>
  resendCooldown: number
  /** Reset error + code state — call when leaving the code step. */
  reset: () => void
}

/**
 * Drives the combined magic-link + OTP sign-in flow. Both the full-page
 * (PortalAuthForm) and the inline dialog (PortalAuthFormInline) consume
 * this so the request/verify/resend logic stays in one place.
 */
export function useEmailSignin({
  callbackUrl,
  onSuccess,
}: UseEmailSigninOptions): UseEmailSigninResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const requestEmail = async (email: string): Promise<{ ok: boolean; error?: string }> => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/portal-signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, callbackURL: callbackUrl }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Failed to send sign-in email')
      }
      setResendCooldown(60)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send sign-in email'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setLoading(false)
    }
  }

  const verify = async (email: string, otp: string): Promise<void> => {
    if (loading) return
    if (otp.length !== 6) return
    setError('')
    setLoading(true)
    try {
      const result = await authClient.signIn.emailOtp({ email, otp })
      if (result.error) {
        throw new Error(result.error.message || 'Invalid or expired code')
      }
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code')
      setLoading(false)
    }
  }

  const resend = async (email: string): Promise<void> => {
    if (resendCooldown > 0 || loading) return
    setCode('')
    await requestEmail(email)
  }

  const reset = () => {
    setError('')
    setCode('')
  }

  return {
    loading,
    error,
    code,
    setCode,
    requestEmail,
    verify,
    resend,
    resendCooldown,
    reset,
  }
}

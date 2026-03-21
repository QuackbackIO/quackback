import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { authClient } from '@/lib/server/auth/client'
import { setPasswordFn } from '@/lib/server/functions/invitations'

export function PasswordForm() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    authClient.listAccounts().then((result) => {
      if (result.data) {
        const hasCredential = result.data.some(
          (acc: { providerId: string }) => acc.providerId === 'credential'
        )
        setHasPassword(hasCredential)
      }
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      if (hasPassword) {
        if (!currentPassword) {
          setError('Current password is required')
          setLoading(false)
          return
        }
        const result = await authClient.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions: false,
        })
        if (result.error) {
          throw new Error(result.error.message || 'Failed to change password')
        }
        toast.success('Password changed')
      } else {
        await setPasswordFn({ data: { newPassword } })
        setHasPassword(true)
        toast.success('Password set')
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  // Loading accounts
  if (hasPassword === null) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Password</h2>
        <p className="text-sm text-muted-foreground mb-4">Loading...</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">{hasPassword ? 'Change password' : 'Set password'}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {hasPassword
            ? 'Update your current password'
            : 'Add a password to sign in with email and password'}
        </p>

        <div className="space-y-4">
          {error && <FormError message={error} />}

          {hasPassword && (
            <div className="space-y-2">
              <label htmlFor="current-password" className="text-sm font-medium">
                Current password
              </label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-medium">
                New password
              </label>
              <Input
                id="new-password"
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirm password
              </label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                loading ||
                newPassword.length < 8 ||
                newPassword !== confirmPassword ||
                (hasPassword && !currentPassword)
              }
            >
              {loading ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 animate-spin mr-2" />
                  {hasPassword ? 'Changing...' : 'Setting...'}
                </>
              ) : hasPassword ? (
                'Change password'
              ) : (
                'Set password'
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

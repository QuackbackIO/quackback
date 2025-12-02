'use client'

import { useState } from 'react'
import { inviteMember } from '@/lib/auth/client'
import { X } from 'lucide-react'

interface InviteMemberDialogProps {
  organizationId: string
  open: boolean
  onClose: () => void
}

export function InviteMemberDialog({
  organizationId,
  open,
  onClose,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { error: inviteError } = await inviteMember({
        organizationId,
        email,
        role,
      })

      if (inviteError) {
        throw new Error(inviteError.message)
      }

      setSuccess(true)
      setEmail('')
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setIsLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-semibold">Invite Team Member</h2>

        {success ? (
          <div className="py-8 text-center">
            <div className="text-primary text-lg font-medium">
              Invitation sent!
            </div>
            <p className="mt-2 text-muted-foreground">
              {email} will receive an email with instructions to join.
            </p>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-input px-3 py-2"
                placeholder="colleague@example.com"
              />
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium">
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                className="mt-1 block w-full rounded-md border border-input px-3 py-2"
              >
                <option value="member">Member - Can view and create feedback</option>
                <option value="admin">Admin - Can manage settings and members</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isLoading ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

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
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-semibold">Invite Team Member</h2>

        {success ? (
          <div className="py-8 text-center">
            <div className="text-green-600 text-lg font-medium">
              Invitation sent!
            </div>
            <p className="mt-2 text-gray-600">
              {email} will receive an email with instructions to join.
            </p>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
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
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
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
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              >
                <option value="member">Member - Can view and create feedback</option>
                <option value="admin">Admin - Can manage settings and members</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
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

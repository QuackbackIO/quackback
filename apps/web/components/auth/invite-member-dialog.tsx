'use client'

import { useState } from 'react'
import { inviteMember } from '@/lib/auth/client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>

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
          <form onSubmit={handleInvite} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="colleague@example.com"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="role" className="text-sm font-medium">
                Role
              </label>
              <Select value={role} onValueChange={(value) => setRole(value as 'admin' | 'member')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member - Can view and create feedback</SelectItem>
                  <SelectItem value="admin">Admin - Can manage settings and members</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Sending...' : 'Send Invitation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

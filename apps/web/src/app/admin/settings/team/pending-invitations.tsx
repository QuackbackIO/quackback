'use client'

import { useState } from 'react'
import { Mail, RefreshCw, Clock, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cancelInvitationAction, resendInvitationAction } from '@/lib/actions/admin'
import type { InviteId } from '@quackback/ids'

interface PendingInvitation {
  id: string
  email: string
  name: string | null
  role: string | null
  createdAt: string
  lastSentAt: string | null
  expiresAt: string
}

interface PendingInvitationsProps {
  invitations: PendingInvitation[]
}

const RESEND_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

export function PendingInvitations({ invitations: initialInvitations }: PendingInvitationsProps) {
  const [invitations, setInvitations] = useState(initialInvitations)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canResend = (lastSentAt: string | null, createdAt: string) => {
    const lastSent = lastSentAt ? new Date(lastSentAt) : new Date(createdAt)
    return Date.now() - lastSent.getTime() >= RESEND_COOLDOWN_MS
  }

  const getTimeUntilResend = (lastSentAt: string | null, createdAt: string) => {
    const lastSent = lastSentAt ? new Date(lastSentAt) : new Date(createdAt)
    const timeSince = Date.now() - lastSent.getTime()
    const remaining = RESEND_COOLDOWN_MS - timeSince
    if (remaining <= 0) return null
    return Math.ceil(remaining / 60000) // minutes
  }

  const handleResend = async (invitationId: string) => {
    setLoadingId(invitationId)
    setError(null)

    try {
      const result = await resendInvitationAction({
        data: {
          invitationId: invitationId as InviteId,
        },
      })

      if (!result.success) {
        throw new Error(result.error.message || 'Failed to resend invitation')
      }

      // Update the lastSentAt in our local state
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.id === invitationId ? { ...inv, lastSentAt: new Date().toISOString() } : inv
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend invitation')
    } finally {
      setLoadingId(null)
    }
  }

  const handleCancel = async (invitationId: string) => {
    setLoadingId(invitationId)
    setError(null)

    try {
      const result = await cancelInvitationAction({
        data: {
          invitationId: invitationId as InviteId,
        },
      })

      if (!result.success) {
        throw new Error(result.error.message || 'Failed to cancel invitation')
      }

      // Remove from local state
      setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel invitation')
    } finally {
      setLoadingId(null)
    }
  }

  if (invitations.length === 0) {
    return null
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border/50">
        <p className="text-sm text-muted-foreground">
          {invitations.length} pending invitation{invitations.length !== 1 ? 's' : ''}
        </p>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <ul className="divide-y divide-border/50">
        {invitations.map((inv) => {
          const isExpired = new Date() > new Date(inv.expiresAt)
          const canResendNow = !isExpired && canResend(inv.lastSentAt, inv.createdAt)
          const minutesUntilResend = getTimeUntilResend(inv.lastSentAt, inv.createdAt)
          const isLoading = loadingId === inv.id

          return (
            <li key={inv.id} className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{inv.name || inv.email}</p>
                  {inv.name && <p className="text-sm text-muted-foreground">{inv.email}</p>}
                  <p className="text-xs text-muted-foreground">
                    Invited {formatDate(inv.createdAt)}
                    {isExpired && <span className="text-destructive ml-1">(expired)</span>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-600 border-amber-500/30"
                >
                  pending
                </Badge>
                <Badge variant="outline" className="bg-muted/50">
                  {inv.role || 'member'}
                </Badge>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleResend(inv.id)}
                        disabled={!canResendNow || isLoading}
                        className="h-8 w-8"
                      >
                        {isLoading ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : minutesUntilResend ? (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isExpired
                        ? 'Invitation expired'
                        : minutesUntilResend
                          ? `Wait ${minutesUntilResend} min to resend`
                          : 'Resend invitation'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCancel(inv.id)}
                        disabled={isLoading}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel invitation</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

import { useState } from 'react'
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/shared/copy-button'
import { TableCell, TableRow } from '@/components/ui/table'
import { cancelInvitationFn, resendInvitationFn } from '@/lib/server/functions/admin'
import { formatDistanceToNow } from 'date-fns'
import type { InviteId } from '@quackback/ids'

export interface PendingInvitation {
  id: string
  email: string
  name: string | null
  role: string | null
  createdAt: string
  lastSentAt: string | null
  expiresAt: string
}

const RESEND_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

export function getExpiryText(expiresAt: string) {
  const now = new Date()
  const expiry = new Date(expiresAt)
  const isExpired = now > expiry
  const msUntilExpiry = expiry.getTime() - now.getTime()
  const isExpiringSoon = !isExpired && msUntilExpiry < 2 * 24 * 60 * 60 * 1000

  const text = isExpired
    ? `Expired ${formatDistanceToNow(expiry, { addSuffix: false })} ago`
    : `Expires in ${formatDistanceToNow(expiry, { addSuffix: false })}`

  const className = isExpired
    ? 'text-destructive'
    : isExpiringSoon
      ? 'text-amber-600'
      : 'text-muted-foreground'

  return { text, className, isExpired }
}

export function formatInviteDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface InvitationActionsProps {
  invitation: PendingInvitation
  onResent: (id: string, lastSentAt: string) => void
  onCancelled: (id: string) => void
  onError: (message: string | null) => void
  onInviteLink: (id: string, link: string) => void
}

export function InvitationActions({
  invitation: inv,
  onResent,
  onCancelled,
  onError,
  onInviteLink,
}: InvitationActionsProps) {
  const [loading, setLoading] = useState<'resend' | 'cancel' | null>(null)

  const expiry = getExpiryText(inv.expiresAt)
  const lastSent = inv.lastSentAt ? new Date(inv.lastSentAt) : new Date(inv.createdAt)
  const canResendNow = !expiry.isExpired && Date.now() - lastSent.getTime() >= RESEND_COOLDOWN_MS
  const remaining = RESEND_COOLDOWN_MS - (Date.now() - lastSent.getTime())
  const minutesUntilResend = remaining > 0 ? Math.ceil(remaining / 60000) : null

  const resendDisabled = !canResendNow || loading !== null
  const resendTitle = expiry.isExpired
    ? 'Invitation expired'
    : minutesUntilResend
      ? `Wait ${minutesUntilResend} min to resend`
      : undefined

  const handleResend = async () => {
    setLoading('resend')
    onError(null)
    try {
      const result = await resendInvitationFn({
        data: { invitationId: inv.id as InviteId },
      })
      onResent(inv.id, new Date().toISOString())
      if (result.emailSent === false && result.inviteLink) {
        onInviteLink(inv.id, result.inviteLink)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to resend invitation')
    } finally {
      setLoading(null)
    }
  }

  const handleCancel = async () => {
    setLoading('cancel')
    onError(null)
    try {
      await cancelInvitationFn({
        data: { invitationId: inv.id as InviteId },
      })
      onCancelled(inv.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to cancel invitation')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleResend}
        disabled={resendDisabled}
        title={resendTitle}
      >
        {loading === 'resend' ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Resend'}
      </Button>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCancel}
              disabled={loading !== null}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              <XMarkIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel invitation</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

/** Renders the invite link row (colspan) below an invitation row after a failed email resend */
export function InviteLinkRow({ link, colSpan }: { link: string; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="pt-0 pb-3">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2">
          <code className="flex-1 truncate text-xs">{link}</code>
          <CopyButton value={link} variant="ghost" size="sm" />
        </div>
      </TableCell>
    </TableRow>
  )
}

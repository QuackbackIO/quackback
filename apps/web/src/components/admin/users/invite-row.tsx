import { useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getPortalInviteLinkFn } from '@/lib/server/functions/portal-invites'
import { cn } from '@/lib/shared/utils'
import type { PortalInvite } from './use-portal-invites'

function formatInviteDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function InviteStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          Pending
        </Badge>
      )
    case 'accepted':
      return (
        <Badge
          variant="outline"
          className="border-green-500/30 text-green-600 text-[10px] px-1.5 py-0"
        >
          Accepted
        </Badge>
      )
    case 'canceled':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          Revoked
        </Badge>
      )
    case 'expired':
      return (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Expired
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {status ?? 'Unknown'}
        </Badge>
      )
  }
}

interface InviteRowProps {
  invite: PortalInvite
  onRevoke: (id: string) => Promise<void>
  onResend: (id: string) => Promise<void>
  revoking: boolean
  resending: boolean
}

/**
 * One row in the portal-invites list. Pending invites show Copy-link /
 * Resend / Revoke actions; other statuses just show the badge.
 *
 * The Revoke button uses an inline "confirm" two-step (avoids a dialog
 * for a per-row destructive action). Copy-link mints a fresh magic-link
 * URL valid for ~10 minutes so admins can hand it to invitees out of
 * band when SMTP isn't reachable.
 */
export function InviteRow({ invite, onRevoke, onResend, revoking, resending }: InviteRowProps) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const sentDate = invite.lastSentAt ?? invite.createdAt

  const handleRevokeClick = () => {
    if (!confirmRevoke) {
      setConfirmRevoke(true)
      return
    }
    setConfirmRevoke(false)
    void onRevoke(invite.id)
  }

  const handleCopyLink = async () => {
    if (copyState === 'copying') return
    setCopyState('copying')
    try {
      const result = await getPortalInviteLinkFn({ data: { inviteId: invite.id } })
      await navigator.clipboard.writeText(result.inviteLink)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 3000)
    } catch {
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 3000)
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invite.email}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Sent {formatInviteDate(sentDate)}</p>
      </div>
      <InviteStatusBadge status={invite.status} />
      {invite.status === 'pending' && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleCopyLink()}
            disabled={copyState === 'copying' || revoking || resending}
            className="h-7 px-2 text-xs"
            title="Mint a fresh sign-in link and copy it to your clipboard"
          >
            {copyState === 'copying' && <ArrowPathIcon className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {copyState === 'copied'
              ? 'Copied — link valid 10 min'
              : copyState === 'error'
                ? 'Copy failed'
                : 'Copy link'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onResend(invite.id)}
            disabled={resending || revoking}
            className="h-7 px-2 text-xs"
          >
            {resending ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : 'Resend'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRevokeClick}
            disabled={resending || revoking}
            className={cn(
              'h-7 px-2 text-xs',
              confirmRevoke
                ? 'border border-destructive/40 text-destructive hover:bg-destructive/10'
                : 'text-muted-foreground hover:text-destructive'
            )}
          >
            {revoking ? (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            ) : confirmRevoke ? (
              'Confirm revoke'
            ) : (
              'Revoke'
            )}
          </Button>
        </div>
      )}
    </li>
  )
}

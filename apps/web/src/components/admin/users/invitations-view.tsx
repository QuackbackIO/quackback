import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { usePortalInvites } from './use-portal-invites'
import { InviteRow } from './invite-row'
import { InvitePeopleDialog } from './invite-people-dialog'

type InvitesStatus = 'pending' | 'accepted' | 'expired' | 'all'

const STATUS_LABEL: Record<InvitesStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  all: 'All',
}

const EMPTY_COPY: Record<InvitesStatus, { title: string; body: string }> = {
  pending: {
    title: 'No pending invitations',
    body: 'Invitations you send appear here until the recipient signs in.',
  },
  accepted: {
    title: 'No accepted invitations yet',
    body: 'Once a recipient clicks their magic link and signs in, the invitation will move here.',
  },
  expired: {
    title: 'No expired invitations',
    body: 'Pending invitations expire after 30 days. Expired ones show here so you can resend.',
  },
  all: {
    title: 'No invitations yet',
    body: 'Use "Invite people" to send the first portal invitation.',
  },
}

interface InvitationsViewProps {
  status: InvitesStatus
}

/**
 * Stand-alone management view for portal invitations, rendered under
 * /admin/users when `?invites=<status>` is set.
 *
 * Filters/segments from the regular Users view do not apply — invitations
 * live in their own table (no user record exists until acceptance), so the
 * People filter chips would be meaningless here.
 */
export function InvitationsView({ status }: InvitationsViewProps) {
  const navigate = useNavigate()
  const portal = usePortalInvites()

  const setStatus = (next: InvitesStatus) => {
    void navigate({
      from: '/admin/users',
      search: (prev) => ({ ...prev, invites: next }),
      replace: true,
    })
  }

  // Filter the single fetched list client-side per the active status.
  // The list is bounded (admin-curated) so this is cheap; an indexed
  // server-side filter would only matter at the thousands.
  const visible = useMemo(() => {
    if (status === 'all') return portal.invites
    return portal.invites.filter((i) => i.status === status)
  }, [portal.invites, status])

  const empty = EMPTY_COPY[status]

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header: title + send-CTA */}
      <div className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">Invitations</h1>
            <p className="text-xs text-muted-foreground">
              Portal access sent to people who don&apos;t yet have an account.
            </p>
          </div>
          <Button type="button" size="sm" onClick={portal.openDialog}>
            <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
            Invite people
          </Button>
        </div>

        {/* Status chips */}
        <div className="flex items-center gap-1 px-4 pb-3">
          <StatusChip
            label={STATUS_LABEL.pending}
            count={portal.pendingCount}
            active={status === 'pending'}
            onClick={() => setStatus('pending')}
          />
          <StatusChip
            label={STATUS_LABEL.accepted}
            count={portal.acceptedCount}
            active={status === 'accepted'}
            onClick={() => setStatus('accepted')}
          />
          <StatusChip
            label={STATUS_LABEL.expired}
            count={portal.expiredCount}
            active={status === 'expired'}
            onClick={() => setStatus('expired')}
          />
          <StatusChip
            label={STATUS_LABEL.all}
            count={portal.invites.length}
            active={status === 'all'}
            onClick={() => setStatus('all')}
          />
        </div>
      </div>

      {/* Inline status messages */}
      {(portal.lastSentSummary || portal.actionError || portal.resendConfirm) && (
        <div className="px-4 pt-3 space-y-1">
          {portal.lastSentSummary && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
              {portal.lastSentSummary}
            </p>
          )}
          {portal.actionError && (
            <p className="text-xs text-destructive" role="alert">
              {portal.actionError}
            </p>
          )}
          {portal.resendConfirm && <p className="text-xs text-muted-foreground">Invite resent.</p>}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {portal.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            <span>Loading invites…</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 p-8 text-center">
            <p className="text-sm font-medium">{empty.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{empty.body}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={portal.openDialog}
            >
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
              Invite people
            </Button>
          </div>
        ) : (
          <ul className="space-y-1.5" role="list" aria-label="Portal invitations">
            {visible.map((inv) => (
              <InviteRow
                key={inv.id}
                invite={inv}
                onRevoke={portal.handleRevoke}
                onResend={portal.handleResend}
                revoking={portal.revokingId === inv.id}
                resending={portal.resendingId === inv.id}
              />
            ))}
          </ul>
        )}
      </div>

      <InvitePeopleDialog
        open={portal.dialogOpen}
        onOpenChange={portal.onOpenChange}
        emailsInput={portal.emailsInput}
        messageInput={portal.messageInput}
        emailError={portal.emailError}
        batchResults={portal.batchResults}
        sendBusy={portal.sendBusy}
        onEmailsChange={portal.onEmailsChange}
        onMessageChange={portal.onMessageChange}
        onSend={portal.onSend}
      />
    </div>
  )
}

/** Pill-shaped tab for the per-status filter. Matches the visual weight of
 *  the regular Users filter chips elsewhere in the admin UI. */
function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border/50 text-muted-foreground hover:bg-muted/50'
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 text-[10px] tabular-nums',
          active ? 'bg-primary/15 text-foreground' : 'bg-muted/50 text-muted-foreground'
        )}
      >
        {count}
      </span>
    </button>
  )
}

// Re-export so the Route file (and any caller that imported from here)
// doesn't have to know where InvitesStatus lives.
export type { InvitesStatus }

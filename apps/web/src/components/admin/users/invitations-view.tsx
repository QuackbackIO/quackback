import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import { PageHeader } from '@/components/shared/page-header'
import { NewButton } from '@/components/shared/new-button'
import { EmptyState } from '@/components/shared/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePortalInvites } from './use-portal-invites'
import { InviteRow } from './invite-row'
import { InvitePeopleDialog } from './invite-people-dialog'

type InvitesStatus = 'pending' | 'accepted' | 'expired' | 'all'

const STATUSES: InvitesStatus[] = ['pending', 'accepted', 'expired', 'all']

const STATUS_LABEL: Record<InvitesStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  all: 'All',
}

const EMPTY_COPY: Record<InvitesStatus, { title: string; body: string }> = {
  pending: {
    title: 'No invitations yet',
    body: 'Invitations appear here until the recipient signs in.',
  },
  accepted: {
    title: 'No accepted invitations yet',
    body: 'Accepted invitations move here once the recipient signs in.',
  },
  expired: {
    title: 'No expired invitations',
    body: 'Pending invitations expire after 30 days and show here to resend.',
  },
  all: {
    title: 'No invitations yet',
    body: 'Invite users to give them access to your portal.',
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
      <div className="w-full max-w-5xl space-y-4 px-4 pt-4 sm:px-6">
        <PageHeader
          title="Invitations"
          actions={
            <NewButton noun="user" onClick={portal.openDialog}>
              Invite users
            </NewButton>
          }
        />

        <Tabs
          value={status}
          onValueChange={(value) => setStatus(value as InvitesStatus)}
          variant="line"
        >
          <TabsList>
            {STATUSES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {STATUS_LABEL[value]}
                {value === 'pending' && portal.pendingCount > 0 && (
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    {portal.pendingCount}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Inline status messages */}
      {(portal.lastSentSummary || portal.actionError || portal.resendConfirm) && (
        <div className="px-4 pt-3 space-y-1 sm:px-6">
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
      <div className="w-full max-w-5xl flex-1 overflow-y-auto px-4 py-3 sm:px-6">
        {portal.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            <span>Loading invites…</span>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            size="compact"
            icon={EnvelopeIcon}
            title={empty.title}
            description={empty.body}
          />
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

// Re-export so the Route file (and any caller that imported from here)
// doesn't have to know where InvitesStatus lives.
export type { InvitesStatus }

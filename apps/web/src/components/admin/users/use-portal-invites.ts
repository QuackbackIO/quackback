import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  sendPortalInviteFn,
  cancelPortalInviteFn,
  resendPortalInviteFn,
  fetchPortalInvitesFn,
} from '@/lib/server/functions/portal-invites'

/**
 * One invitation row as returned by `fetchPortalInvitesFn` and rendered by
 * the InviteRow component. Lives in this module so consumers don't have to
 * reach into the server-fn return type.
 */
export interface PortalInvite {
  id: string
  email: string
  status: string | null
  createdAt: string
  lastSentAt: string | null
}

export const PORTAL_INVITES_QUERY_KEY = ['portal', 'invites'] as const

/**
 * Loose-email syntax check used for client-side validation in the send form.
 * Server-side validation is the source of truth — this only catches obvious
 * typos before the round-trip.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function partitionValidEmails(items: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const item of items) {
    // Normalize valid addresses to lowercase to match the server's
    // insert path — otherwise the failed-list rendering and any retry
    // workflow drift from what the server actually stored.
    if (EMAIL_RE.test(item)) valid.push(item.toLowerCase())
    else invalid.push(item)
  }
  return { valid, invalid }
}

/**
 * Shared state machine + actions for the portal-invite UIs. Both the Portal
 * Settings invite section and the /admin/users Invitations view consume
 * this so the dialog, count summary, and row actions stay in lock-step.
 *
 * - `invites`/counts: live list driven by `fetchPortalInvitesFn`.
 * - `dialogOpen` + form state: the send dialog lives here so closing it
 *   resets cleanly and partial-failure can keep it open with the failed
 *   addresses re-populated.
 * - `handleSend` returns the per-address results so the caller can decide
 *   what to show (we close on full success, keep open on partial fail).
 * - `handleResend`/`handleRevoke`: row actions, with per-row busy state.
 */
export interface UsePortalInvitesOptions {
  /**
   * Whether to actually fire the `fetchPortalInvitesFn` query. The
   * underlying server fn requires `roles: ['admin']` and will 403 for
   * `member` / `user`. UsersContainer mounts this hook for every
   * /admin/users render (even non-admin members hitting the page),
   * so callers MUST gate the query on the caller's role to avoid
   * console-noisy 403s on every page load.
   *
   * Defaults to `true` so existing call sites that knew they were
   * admin-scoped (PortalAuthTab inside Settings, which is admin-only)
   * keep working without change.
   */
  enabled?: boolean
}

export function usePortalInvites(options: UsePortalInvitesOptions = {}) {
  const { enabled = true } = options
  const queryClient = useQueryClient()

  const query = useQuery<PortalInvite[]>({
    queryKey: PORTAL_INVITES_QUERY_KEY,
    queryFn: () => fetchPortalInvitesFn(),
    staleTime: 30 * 1000,
    enabled,
  })

  const invites = query.data ?? []
  const pendingCount = invites.filter((i) => i.status === 'pending').length
  const acceptedCount = invites.filter((i) => i.status === 'accepted').length
  const expiredCount = invites.filter((i) => i.status === 'expired').length
  const canceledCount = invites.filter((i) => i.status === 'canceled').length

  const refetch = () => queryClient.invalidateQueries({ queryKey: PORTAL_INVITES_QUERY_KEY })

  // ---------- Send dialog state ----------
  const [dialogOpen, setDialogOpen] = useState(false)
  const [emailsInput, setEmailsInput] = useState('')
  const [messageInput, setMessageInput] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [batchResults, setBatchResults] = useState<null | {
    sent: number
    failed: Array<{ email: string; error: string }>
  }>(null)
  const [sendBusy, setSendBusy] = useState(false)
  const [lastSentSummary, setLastSentSummary] = useState<string | null>(null)

  // Tracks any pending fade-out timers (lastSentSummary, resendConfirm)
  // so we can cancel them on unmount — otherwise the timeout fires
  // setState on a torn-down hook (three live consumer components mount
  // this hook today, so a single send leaks per navigation).
  const timerRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  useEffect(() => {
    const timers = timerRefs.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])
  const trackedSetTimeout = (cb: () => void, ms: number) => {
    const t = setTimeout(() => {
      timerRefs.current.delete(t)
      cb()
    }, ms)
    timerRefs.current.add(t)
    return t
  }

  const handleDialogChange = (next: boolean) => {
    setDialogOpen(next)
    if (!next) {
      setEmailsInput('')
      setMessageInput('')
      setEmailError(null)
      setBatchResults(null)
      // Clear the success summary so reopening within the fade window
      // doesn't render a stale "Sent N invites" banner above the new
      // send. The summary's autoclear timer is also still in-flight;
      // it'll no-op when it fires.
      setLastSentSummary(null)
    }
  }

  const openDialog = () => setDialogOpen(true)

  const handleSend = async () => {
    if (sendBusy) return
    setEmailError(null)
    setBatchResults(null)

    const raw = parseEmailList(emailsInput)
    if (raw.length === 0) {
      setEmailError('Enter at least one email address.')
      return
    }
    if (raw.length > 50) {
      setEmailError('You can send at most 50 invites at a time. Trim the list and try again.')
      return
    }
    const { valid, invalid } = partitionValidEmails(raw)
    if (invalid.length > 0) {
      setEmailError(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`)
      return
    }

    setSendBusy(true)
    try {
      const message = messageInput.trim() || undefined
      const result = await sendPortalInviteFn({ data: { emails: valid, message } })
      const sent = result.results.filter((r) => r.ok).length
      const failed = result.results.filter(
        (r): r is { email: string; ok: false; error: string } => !r.ok
      )
      if (sent > 0) {
        void refetch()
      }
      // Full success → close + brief inline summary. Partial fail → keep
      // open with only the failed addresses in the textarea so retry sends
      // only those.
      if (failed.length === 0) {
        setLastSentSummary(`Sent ${sent} invite${sent === 1 ? '' : 's'}.`)
        trackedSetTimeout(() => setLastSentSummary(null), 4000)
        handleDialogChange(false)
      } else {
        setBatchResults({ sent, failed })
        setEmailsInput(failed.map((f) => f.email).join(', '))
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send invites.')
    } finally {
      setSendBusy(false)
    }
  }

  // ---------- Row actions ----------
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [resendConfirm, setResendConfirm] = useState<string | null>(null)

  const handleResend = async (id: string) => {
    setActionError(null)
    setResendingId(id)
    setResendConfirm(null)
    try {
      await resendPortalInviteFn({ data: { inviteId: id } })
      setResendConfirm(id)
      void refetch()
      trackedSetTimeout(() => setResendConfirm((prev) => (prev === id ? null : prev)), 3000)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resend invite.')
    } finally {
      setResendingId(null)
    }
  }

  const handleRevoke = async (id: string) => {
    setActionError(null)
    setRevokingId(id)
    try {
      await cancelPortalInviteFn({ data: { inviteId: id } })
      void refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke invite.')
    } finally {
      setRevokingId(null)
    }
  }

  return {
    // data
    invites,
    isLoading: query.isLoading,
    pendingCount,
    acceptedCount,
    expiredCount,
    canceledCount,
    // dialog
    dialogOpen,
    openDialog,
    onOpenChange: handleDialogChange,
    emailsInput,
    messageInput,
    emailError,
    batchResults,
    sendBusy,
    onEmailsChange: (v: string) => {
      setEmailsInput(v)
      if (emailError) setEmailError(null)
    },
    onMessageChange: setMessageInput,
    onSend: () => void handleSend(),
    lastSentSummary,
    // row actions
    resendingId,
    revokingId,
    actionError,
    resendConfirm,
    handleResend,
    handleRevoke,
  }
}

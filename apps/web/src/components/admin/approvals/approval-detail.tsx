import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon, CheckIcon } from '@heroicons/react/24/outline'
import type { ApprovalView } from '@/lib/server/domains/assistant/approvals.queue'
import {
  approveApprovalFn,
  approveApprovalFromEmailFn,
  rejectApprovalFn,
  type ApprovalDecisionResult,
} from '@/lib/server/functions/approvals'
import { undoWorkspaceSettingsProposalFn } from '@/lib/server/functions/workspace-copilot'
import { approvalKeys, approvalQueries } from '@/lib/client/queries/approvals'
import { AskMessages } from '@/components/admin/ask/ask-messages'
import { settingsAreaLabel } from '@/components/admin/ask/workspace-settings-proposal-card'
import { refreshSettingsAreaQueries } from '@/components/admin/ask/settings-proposal-cache'
import { getTimeAgo } from '@/components/ui/time-ago'
import { Button } from '@/components/ui/button'
import { SignInAgainDialog } from '@/components/auth/sign-in-again-dialog'
import { useSignInAgain } from '@/lib/client/hooks/use-sign-in-again'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { SettingsArea } from '@/lib/shared/assistant/settings-proposals'
import { cn } from '@/lib/shared/utils'
import { RECENT_SIGN_IN_REQUIRED } from '@/lib/shared/approval-refusal'
import { approvalMessages, outcomeMessage, refusalMessage } from './approval-messages'
import { personOf, requesterOf } from './approval-people'
import { ApprovalRiskChip } from './approval-risk-chip'
import { ApprovalChanges } from './approval-changes'

const bold = (chunks: ReactNode[]) => <b className="font-medium text-foreground">{chunks}</b>

/** Where a request stands for the person looking at it. */
type Stage =
  'deciding' | 'rejecting' | 'approved' | 'applied' | 'failed' | 'rejected' | 'undone' | 'history'

function stageOf(approval: ApprovalView, decidedHere: boolean, rejecting: boolean): Stage {
  if (approval.status === 'proposed') return rejecting ? 'rejecting' : 'deciding'
  if (!decidedHere) return 'history'
  if (approval.status === 'rejected') return 'rejected'
  if (approval.status === 'failed') return 'failed'
  // Approved but not yet carried out: another call for the same request runs it.
  if (approval.status === 'approved') return 'approved'
  return approval.undone ? 'undone' : 'applied'
}

/** The area a request acts on: the settings it changes, or its conversation or ticket. */
function useAreaLabel(approval: ApprovalView): string | null {
  const intl = useIntl()
  if (approval.diff.kind === 'settings') {
    const areas = [...new Set(approval.diff.changes.map((change) => change.area))]
    return intl.formatMessage(approvalMessages.areaSettings, {
      areas: areas.map((area) => settingsAreaLabel(intl, area as SettingsArea)).join(', '),
    })
  }
  if (approval.parent.kind === 'conversation')
    return intl.formatMessage(approvalMessages.areaConversation)
  if (approval.parent.kind === 'ticket') return intl.formatMessage(approvalMessages.areaTicket)
  return null
}

function settingsAreasOf(approval: ApprovalView): SettingsArea[] {
  return approval.diff.kind === 'settings'
    ? approval.diff.changes.map((change) => change.area as SettingsArea)
    : []
}

export interface ApprovalDetailProps {
  approval: ApprovalView
  /** Decided on this page in this visit, so its outcome shows in place. */
  decidedHere: boolean
  /** The request as it now stands, after a decision or a refresh. */
  onChange: (approval: ApprovalView, decided: boolean) => void
  source?: 'app' | 'email'
  onBack?: () => void
}

/** One request: who asked and for whom, what changes, and Approve or Reject. */
export function ApprovalDetail({
  approval,
  decidedHere,
  onChange,
  onBack,
  source = 'app',
}: ApprovalDetailProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const reasonId = useId()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The pressed button goes away with a decision or an undo, so focus moves
  // to what replaced it: Undo when the change can be undone, else the result.
  const [focusOutcome, setFocusOutcome] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const area = useAreaLabel(approval)
  const stage = stageOf(approval, decidedHere, rejecting)
  const requester = requesterOf(approval, intl)
  const person = personOf(approval)

  useEffect(() => {
    if (!focusOutcome || busy) return
    const target = undoRef.current ?? resultRef.current
    if (!target) return
    target.focus()
    setFocusOutcome(false)
  }, [focusOutcome, busy, stage, approval])

  const refresh = async () => {
    const fresh = await queryClient.fetchQuery({
      ...approvalQueries.detail(approval.id),
      staleTime: 0,
    })
    onChange(fresh, false)
  }

  /**
   * Show the outcome, then refresh what it changed elsewhere: the rail, Home,
   * the decided list and any settings it wrote. The decision already stands,
   * so a refresh that fails is left to the next read.
   */
  const settle = async (settled: ApprovalView) => {
    onChange(settled, true)
    const areas = settled.status === 'executed' ? settingsAreasOf(settled) : []
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: approvalKeys.waiting() }),
        queryClient.invalidateQueries({ queryKey: approvalKeys.list('decided') }),
        areas.length > 0 ? refreshSettingsAreaQueries(queryClient, areas) : null,
      ])
      if (areas.length > 0) await router.invalidate()
    } catch {
      // Left to the next read.
    }
  }

  // A high-risk request needs a sign-in made just before the decision. The
  // refusal opens the dialog, and the approve is sent again once, after it.
  const approveAction = `approve:${approval.id}:${approval.contentHash}`
  const resumedRef = useRef<string | null>(null)
  const approveRef = useRef<() => Promise<void>>(async () => undefined)
  const signIn = useSignInAgain({
    onSignedIn: (action) => {
      if (action !== approveAction || resumedRef.current === action) return
      resumedRef.current = action
      void approveRef.current()
    },
  })

  const refused = async (code: string) => {
    if (code === RECENT_SIGN_IN_REQUIRED) {
      resumedRef.current = null
      return signIn.request(approveAction)
    }
    setError(intl.formatMessage(refusalMessage(code)))
    if (code === 'APPROVAL_CONTENT_CHANGED' || code === 'PENDING_ACTION_NOT_DECIDABLE')
      await refresh().catch(() => undefined)
  }

  const decide = async (run: () => Promise<ApprovalDecisionResult>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (result.ok) {
        setRejecting(false)
        setReason('')
        setFocusOutcome(true)
        await settle(result.approval)
      } else await refused(result.code)
    } catch {
      setError(intl.formatMessage(approvalMessages.errorFailed))
    } finally {
      setBusy(false)
    }
  }

  const approve = () =>
    decide(() =>
      (source === 'email' ? approveApprovalFromEmailFn : approveApprovalFn)({
        data: { approvalId: approval.id, contentHash: approval.contentHash },
      })
    )

  approveRef.current = approve

  const reject = () =>
    decide(() =>
      rejectApprovalFn({
        data: {
          approvalId: approval.id,
          contentHash: approval.contentHash,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      })
    )

  const undo = async () => {
    setBusy(true)
    setError(null)
    try {
      const undone = await undoWorkspaceSettingsProposalFn({
        data: { pendingActionId: approval.id },
      })
      if (!undone.ok) return setError(intl.formatMessage(refusalMessage(undone.code)))
      const fresh = await queryClient.fetchQuery({
        ...approvalQueries.detail(approval.id),
        staleTime: 0,
      })
      setFocusOutcome(true)
      await settle(fresh)
    } catch {
      setError(intl.formatMessage(approvalMessages.errorFailed))
    } finally {
      setBusy(false)
    }
  }

  const decision =
    approval.status === 'rejected'
      ? intl.formatMessage(approvalMessages.rejectedBy, {
          name: approval.decidedByName ?? intl.formatMessage(approvalMessages.someone),
        })
      : approval.decidedAt
        ? intl.formatMessage(approvalMessages.approvedBy, {
            name: approval.decidedByName ?? intl.formatMessage(approvalMessages.someone),
          })
        : null
  // A request decided before this visit says how it ended beside who decided it.
  const outcome =
    stage === 'history' && approval.status !== 'rejected' ? outcomeMessage(approval) : null

  return (
    <section aria-labelledby={`${reasonId}-title`} className="px-5 pt-6 pb-10 sm:px-9 sm:pt-7">
      {onBack && (
        <Button variant="ghost" size="sm" className="-ms-2 mb-3 md:hidden" onClick={onBack}>
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {intl.formatMessage(approvalMessages.back)}
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <ApprovalRiskChip risk={approval.risk} />
        {area && <span className="text-[13px] text-muted-foreground">{area}</span>}
      </div>
      <h2
        id={`${reasonId}-title`}
        className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-foreground"
      >
        {approval.summary}
      </h2>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span>
          {intl.formatMessage(approvalMessages.requestedBy, { name: requester, b: bold })}
        </span>
        {person && (
          <span>{intl.formatMessage(approvalMessages.for, { name: person, b: bold })}</span>
        )}
        <span>{getTimeAgo(approval.proposedAt, intl.locale)}</span>
        {approval.status === 'proposed' ? (
          <span>
            {intl.formatMessage(approvalMessages.expires, {
              when: getTimeAgo(approval.expiresAt, intl.locale),
            })}
          </span>
        ) : (
          decision && <span>{decision}</span>
        )}
        {outcome && <span>{intl.formatMessage(outcome)}</span>}
        {approval.status === 'rejected' && approval.decisionReason && (
          <span>
            {intl.formatMessage(approvalMessages.reasonGiven, { reason: approval.decisionReason })}
          </span>
        )}
      </div>

      <Suspense fallback={null}>
        <AskMessages>
          <ApprovalChanges diff={approval.diff} />
        </AskMessages>
      </Suspense>

      {stage === 'deciding' && approval.canDecide && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button type="button" disabled={busy} onClick={() => void approve()}>
            {intl.formatMessage(approvalMessages.approve)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null)
              setRejecting(true)
            }}
          >
            {intl.formatMessage(approvalMessages.reject)}
          </Button>
        </div>
      )}

      {stage === 'rejecting' && (
        <div className="mt-5 max-w-lg space-y-2.5">
          <Label htmlFor={reasonId} className="text-sm font-normal text-muted-foreground">
            {intl.formatMessage(approvalMessages.reasonLabel)}
          </Label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={500}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void reject()}>
              {intl.formatMessage(approvalMessages.reject)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRejecting(false)
                setError(null)
              }}
            >
              {intl.formatMessage(approvalMessages.cancel)}
            </Button>
          </div>
        </div>
      )}

      {(stage === 'applied' ||
        stage === 'approved' ||
        stage === 'failed' ||
        stage === 'rejected' ||
        stage === 'undone') && (
        <div
          ref={resultRef}
          role="status"
          tabIndex={-1}
          className={cn(
            'mt-6 flex items-center gap-3 rounded-xl border px-4 py-3.5 text-sm outline-none duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1',
            stage === 'applied'
              ? 'border-success/30 bg-success/10 text-foreground'
              : 'border-border bg-muted/40 text-foreground'
          )}
        >
          {stage === 'applied' && (
            <CheckIcon className="size-4 shrink-0 text-success" aria-hidden="true" />
          )}
          <span className="min-w-0">
            {stage === 'applied'
              ? approval.undoable
                ? intl.formatMessage(approvalMessages.applied)
                : intl.formatMessage(approvalMessages.appliedFinal)
              : stage === 'approved'
                ? intl.formatMessage(approvalMessages.approvedOnly)
                : stage === 'rejected'
                  ? intl.formatMessage(approvalMessages.rejected)
                  : stage === 'undone'
                    ? intl.formatMessage(approvalMessages.undone)
                    : intl.formatMessage(approvalMessages.failed)}
          </span>
          {stage === 'applied' && approval.undoable && (
            <button
              ref={undoRef}
              type="button"
              disabled={busy}
              onClick={() => void undo()}
              className="ms-auto shrink-0 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {intl.formatMessage(approvalMessages.undo)}
            </button>
          )}
        </div>
      )}

      <SignInAgainDialog {...signIn.dialog} />

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

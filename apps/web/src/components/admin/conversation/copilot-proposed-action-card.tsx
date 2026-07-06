/**
 * Quinn Copilot's proposed-action card (split out of copilot-panel.tsx, a
 * pure move — see that file's header for the surface this belongs to):
 * one write-tool call a Copilot turn proposed (P2-C.4, "act-on-approval").
 */
import { CheckCircleIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { ArrowPathIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import type { AssistantPendingActionId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { usePendingActionDecision } from '@/lib/client/hooks/use-pending-action-decision'
import type { CopilotProposedAction } from '@/lib/shared/assistant/copilot-contract'

/** Terminal-status copy for a decided proposal that ISN'T executed/failed
 *  (those two get their own richer treatment below). Mirrors
 *  pending-action-card.tsx's TERMINAL_LABEL for the states it shares. */
const PROPOSED_ACTION_TERMINAL_LABEL: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
}

/** Pull a short, human line out of a tool's JSON result, if it offered one
 *  (create_ticket's reference/title, or any tool's own `note`). Returns null
 *  when nothing recognizable is there; the card falls back to a generic
 *  "Approved and executed" in that case. */
function formatProposedActionResult(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const r = result as Record<string, unknown>
  if (typeof r.note === 'string' && r.note) return r.note
  if (typeof r.reference === 'string' && r.reference) return `Ticket ${r.reference}`
  if (typeof r.title === 'string' && r.title) return r.title
  return null
}

/** The `{error}` a failed execution settled with (markPendingActionFailed's result shape). */
function formatProposedActionFailure(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const error = (result as Record<string, unknown>).error
  return typeof error === 'string' && error ? error : null
}

/**
 * One write-tool call this Copilot turn proposed (P2-C.4, "act-on-approval"):
 * tool label + summary + Approve/Reject, wired to the SAME gated server fns
 * the inbox approval queue uses, via the shared `usePendingActionDecision`
 * hook (data+mutations+busy+inlineError+decide, including the on-error
 * refetch that keeps this card from showing stale buttons after a 409/403 —
 * see the hook's doc comment) so this card can never show a stale status
 * relative to the inbox note card announcing the same proposal. A distinct
 * visual from pending-action-card.tsx (that one's amber note-card chrome is
 * built for the conversation thread, not a Copilot answer bubble), same data
 * plumbing underneath.
 */
export function CopilotProposedActionCard({ action }: { action: CopilotProposedAction }) {
  const id = action.id as AssistantPendingActionId
  const { data, isLoading, isError, busy, approving, rejecting, inlineError, approve, reject } =
    usePendingActionDecision(id)

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        {action.label}
      </div>
      <p className="text-muted-foreground">{action.summary}</p>

      {isLoading ? (
        <span className="text-muted-foreground">Checking status…</span>
      ) : isError ? (
        <span className="text-muted-foreground">Couldn&apos;t load the current status</span>
      ) : data?.status === 'proposed' ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Button type="button" size="sm" disabled={busy} onClick={approve}>
            {approving ? (
              <>
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> Approving…
              </>
            ) : (
              <>
                <CheckIcon className="h-3.5 w-3.5" /> Approve
              </>
            )}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reject}>
            {rejecting ? (
              <>
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> Rejecting…
              </>
            ) : (
              <>
                <XMarkIcon className="h-3.5 w-3.5" /> Reject
              </>
            )}
          </Button>
        </div>
      ) : data?.status === 'executed' ? (
        <div className="flex items-center gap-1.5 pt-0.5 text-emerald-700 dark:text-emerald-400">
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
          <span>{formatProposedActionResult(data.result) ?? 'Approved and executed'}</span>
        </div>
      ) : data?.status === 'failed' ? (
        <span className="pt-0.5 text-destructive">
          {formatProposedActionFailure(data.result) ?? 'This action could not be completed.'}
        </span>
      ) : (
        <span className="pt-0.5 font-medium text-muted-foreground">
          {data
            ? (PROPOSED_ACTION_TERMINAL_LABEL[data.status] ?? data.status)
            : 'Unable to load status'}
        </span>
      )}
      {inlineError && <span className="text-destructive">{inlineError}</span>}
    </div>
  )
}

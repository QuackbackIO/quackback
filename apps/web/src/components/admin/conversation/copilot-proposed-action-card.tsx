/**
 * Copilot's proposed-action card (split out of copilot-panel.tsx, a
 * pure move — see that file's header for the surface this belongs to):
 * one write-tool call a Copilot turn proposed (P2-C.4, "act-on-approval").
 */
import { CheckCircleIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { ArrowPathIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import type { AssistantPendingActionId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { usePendingActionDecision } from '@/lib/client/hooks/use-pending-action-decision'
import type { CopilotProposedAction } from '@/lib/shared/assistant/copilot-contract'
import {
  CONNECTOR_RESPONSE_CHAR_LIMIT,
  parseConnectorToolName,
} from '@/lib/shared/assistant/connectors'

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

/** Stored connector output is untrusted content, displayed as bounded text only. */
function connectorResultPreview(result: unknown): { text: string; truncated: boolean } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const value = result as Record<string, unknown>
  if (value.ok !== true || !Object.prototype.hasOwnProperty.call(value, 'data')) return null
  try {
    const text = typeof value.data === 'string' ? value.data : JSON.stringify(value.data, null, 2)
    if (text === undefined) return null
    return {
      text: text.slice(0, CONNECTOR_RESPONSE_CHAR_LIMIT),
      truncated: text.length > CONNECTOR_RESPONSE_CHAR_LIMIT,
    }
  } catch {
    return null
  }
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
  const executedConnector =
    data?.status === 'executed' && parseConnectorToolName(data.toolName) !== null
  const preview = executedConnector ? connectorResultPreview(data.result) : null
  const resultSummary = formatProposedActionResult(data?.result) ?? 'Approved and executed'
  const summaryTruncated = executedConnector && resultSummary.length > CONNECTOR_RESPONSE_CHAR_LIMIT

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        {action.label}
        {action.connector && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <span className="inline-flex size-4 items-center justify-center rounded-sm bg-primary/15 text-[11px] font-semibold text-primary">
              {action.connector.initials}
            </span>
            {action.connector.name}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">{action.summary}</p>
      {action.argsPreview && Object.keys(action.argsPreview).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-md bg-muted/70 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
          {Object.entries(action.argsPreview).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="min-w-[74px] text-muted-foreground">{key}</dt>
              <dd className="min-w-0 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      )}

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
        <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircleIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              {summaryTruncated
                ? resultSummary.slice(0, CONNECTOR_RESPONSE_CHAR_LIMIT)
                : resultSummary}
            </span>
          </div>
          {summaryTruncated && (
            <span className="text-muted-foreground">Result note truncated.</span>
          )}
          {preview && (
            <div className="min-w-0 rounded-md bg-muted/70 px-2.5 py-2">
              <p className="mb-1 font-medium text-muted-foreground">Connector result</p>
              <pre
                aria-label="Connector result"
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground"
              >
                {preview.text}
              </pre>
              {preview.truncated && (
                <p className="mt-1 text-muted-foreground">Result preview truncated.</p>
              )}
            </div>
          )}
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

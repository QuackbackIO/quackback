/**
 * Copilot usage + outcome reporting (P2-D.2): questions asked, transforms
 * run, on-demand summaries, the insert/feedback outcomes, and the
 * propose-approve-execute actions funnel, over the last 30 days. Read-only
 * reporting; gated server-side on analytics.view like the rest of the Quinn
 * performance surface. Mounted whenever assistantCopilot is on (see
 * automation.assistant.tsx); only the actions funnel additionally needs
 * assistantActions — the pending-actions funnel this section reports on
 * doesn't exist otherwise — so the page passes that flag as
 * `showActionsFunnel` rather than gating the whole card on it.
 */
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { MetricTile, useLast30DaysRange, pct, asRate } from './metric-tile'
import { copilotUsageMetricsQuery } from '@/lib/client/queries/assistant-copilot-analytics'

/** Admin-facing labels for the raw metadata.transform values. Falls back to
 *  the raw value itself for anything not in the catalogue, so a legacy or
 *  future transform kind still renders instead of disappearing. */
const TRANSFORM_LABELS: Record<string, string> = {
  my_tone: 'My tone',
  more_friendly: 'More friendly',
  more_formal: 'More formal',
  more_concise: 'More concise',
  expand: 'Expand',
  rephrase: 'Rephrase',
  fix_grammar: 'Fix grammar',
}

interface CountRowProps {
  label: string
  value: number | undefined
}

/** One label + tabular count line, the card's shared list-row shape. */
function CountRow({ label, value }: CountRowProps) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums text-muted-foreground">{value ?? '—'}</span>
    </li>
  )
}

export interface CopilotUsageCardProps {
  /** True when the assistantActions flag is on; gates only the actions-funnel
   *  section (approval-rate tile + propose/approve/reject/expire list). */
  showActionsFunnel: boolean
}

export function CopilotUsageCard({ showActionsFunnel }: CopilotUsageCardProps) {
  const range = useLast30DaysRange()
  const { data } = useQuery(copilotUsageMetricsQuery(range.from, range.to))

  const transforms = data?.transformsByKind ?? []
  const teammates = data?.perTeammate ?? []

  return (
    <SettingsCard
      title="Copilot usage"
      description="Questions, transforms, and summaries from the inbox Copilot sidebar over the last 30 days, and whether the answers actually got used."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Questions asked" value={data ? String(data.totalQuestions) : '—'} />
        <MetricTile label="Transforms run" value={data ? String(data.totalTransforms) : '—'} />
        <MetricTile label="Summaries generated" value={data ? String(data.totalSummaries) : '—'} />
        {showActionsFunnel && (
          <MetricTile
            label="Approval rate"
            value={pct(asRate(data?.approvalRate))}
            sub={data ? `${data.actionsApproved} of ${data.actionsProposed} proposed` : undefined}
          />
        )}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-medium">Outcomes</h3>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <MetricTile
              label="Insert rate"
              value={pct(asRate(data?.insertRate))}
              sub={
                data
                  ? // insertRate's numerator is every inserted event (answers +
                    // transforms + summaries), so the sub-line mirrors that sum.
                    `${data.answersInserted + data.transformsInserted + data.summariesInserted} inserted from ${data.totalQuestions} questions`
                  : undefined
              }
            />
            {/* What was inserted (the gesture kinds), then where it landed
                (the destination split) — the two axes of every insert event. */}
            <ul className="mt-3 space-y-1.5 text-sm">
              <CountRow label="Answers inserted" value={data?.answersInserted} />
              <CountRow label="Transforms inserted" value={data?.transformsInserted} />
              <CountRow label="Summaries inserted" value={data?.summariesInserted} />
              <CountRow label="Landed in a reply" value={data?.insertedReplies} />
              <CountRow label="Landed in a note" value={data?.insertedNotes} />
            </ul>
          </div>
          <div>
            <MetricTile
              label="Helpful votes"
              value={data ? String(data.feedbackUp) : '—'}
              sub={data ? `${data.feedbackDown} not helpful` : undefined}
            />
            {/* The up/down split already lives on the tile; the list only
                carries the one count the tile can't: reasoned thumbs-downs. */}
            <ul className="mt-3 space-y-1.5 text-sm">
              <CountRow label="Thumbs down with a reason" value={data?.feedbackDownWithReason} />
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium">Top teammates</h3>
          {teammates.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No Copilot questions for this period.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {teammates.map((teammate) => (
                <li
                  key={teammate.principalId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{teammate.displayName ?? 'Unknown teammate'}</span>
                  <span className="tabular-nums text-muted-foreground">{teammate.questions}</span>
                </li>
              ))}
            </ul>
          )}

          {transforms.length > 0 && (
            <>
              <h3 className="mt-4 mb-2 text-sm font-medium">Transforms by kind</h3>
              <ul className="space-y-1.5">
                {transforms.map((row) => (
                  <li
                    key={row.transform}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate">
                      {TRANSFORM_LABELS[row.transform] ?? row.transform}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{row.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {showActionsFunnel && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Actions funnel</h3>
            <ul className="space-y-1.5 text-sm">
              <CountRow label="Proposed" value={data?.actionsProposed} />
              <CountRow label="Approved" value={data?.actionsApproved} />
              <CountRow label="Rejected" value={data?.actionsRejected} />
              <CountRow label="Expired" value={data?.actionsExpired} />
            </ul>
          </div>
        )}
      </div>
    </SettingsCard>
  )
}

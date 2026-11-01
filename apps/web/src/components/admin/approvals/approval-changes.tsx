import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { InformationCircleIcon } from '@heroicons/react/24/outline'
import type { ApprovalDiff } from '@/lib/server/domains/assistant/approvals.queue'
import {
  SettingsValue,
  settingsAreaLabel,
  settingsEffectMessage,
  settingsFieldLabel,
} from '@/components/admin/ask/workspace-settings-proposal-card'
import type { MessengerEffect, SettingsArea } from '@/lib/shared/assistant/settings-proposals'
import { approvalMessages } from './approval-messages'

interface ChangeRow {
  key: string
  field: string
  from: ReactNode | null
  to: ReactNode
}

/** An action's own field name, made readable: "ticketType" reads "Ticket type". */
function readableField(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words[0]!.toUpperCase() + words.slice(1) : key
}

/** An action's value as it reads; null when the action clears the field. */
function readableValue(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value)
}

function useChangeRows(diff: ApprovalDiff): ChangeRow[] {
  const intl = useIntl()
  if (diff.kind === 'design') {
    return diff.changes.map((change) => ({
      key: change.path,
      field: change.label,
      from: <SettingsValue value={change.before} />,
      to: <SettingsValue value={change.after} />,
    }))
  }
  if (diff.kind === 'settings') {
    // A request across areas names each change's area: "Messenger: Enabled".
    const acrossAreas = new Set(diff.changes.map((change) => change.area)).size > 1
    return diff.changes.map((change) => {
      const field = settingsFieldLabel(intl, change.path)
      return {
        key: change.id,
        field: acrossAreas
          ? `${settingsAreaLabel(intl, change.area as SettingsArea)}: ${field}`
          : field,
        from: <SettingsValue value={change.before} preview={change.beforePreview} />,
        to: <SettingsValue value={change.after} preview={change.afterPreview} />,
      }
    })
  }
  const args = diff.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return []
  return Object.entries(args).map(([key, value]) => ({
    key,
    field: readableField(key),
    from: null,
    to: (
      <span className="break-words">
        {readableValue(value) ?? intl.formatMessage(approvalMessages.none)}
      </span>
    ),
  }))
}

/** What a settings request turns on or off besides its own fields. */
function impactsOf(diff: ApprovalDiff): Array<{ effect: MessengerEffect; after: unknown }> {
  if (diff.kind !== 'settings') return []
  const seen = new Set<MessengerEffect>()
  const impacts: Array<{ effect: MessengerEffect; after: unknown }> = []
  for (const change of diff.changes)
    for (const effect of change.effects ?? [])
      if (!seen.has(effect)) {
        seen.add(effect)
        impacts.push({ effect, after: change.after })
      }
  return impacts
}

/** The Changes table, field by field from → to, and the impact line when there is one. */
export function ApprovalChanges({ diff }: { diff: ApprovalDiff }) {
  const intl = useIntl()
  const rows = useChangeRows(diff)
  const impacts = impactsOf(diff)
  return (
    <>
      {rows.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border/70 bg-muted/40 px-4 py-2.5 text-[13px] font-medium text-muted-foreground">
            {intl.formatMessage(approvalMessages.changes)}
          </div>
          <dl className="divide-y divide-border/60">
            {rows.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:items-baseline sm:gap-4"
              >
                <dt className="text-muted-foreground">{row.field}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {row.from !== null && (
                    <>
                      <span className="sr-only">{intl.formatMessage(approvalMessages.from)}</span>
                      <span className="min-w-0 text-muted-foreground line-through">{row.from}</span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        →
                      </span>
                      <span className="sr-only">{intl.formatMessage(approvalMessages.to)}</span>
                    </>
                  )}
                  <span className="min-w-0 font-medium text-foreground">{row.to}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {impacts.length > 0 && (
        <div className="mt-3.5 flex gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm leading-relaxed text-foreground">
          <InformationCircleIcon
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <ul className="space-y-0.5">
            {impacts.map(({ effect, after }) => (
              <li key={effect}>{intl.formatMessage(settingsEffectMessage(effect, after))}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

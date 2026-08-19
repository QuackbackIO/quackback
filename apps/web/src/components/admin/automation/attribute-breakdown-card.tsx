/**
 * Per-attribute value breakdown (§C2.7 / AI-ATTRIBUTES-PARITY-SPEC.md Phase 4
 * reporting segmentation): pick a select/multi_select conversation attribute
 * and see conversation counts per option over the last 30 days, resolving
 * option ids to their labels via the live attribute registry. This is the v1
 * minimal reporting UI the Phase 4 report scopes to — see attribute-reporting.ts
 * for what a richer dashboard integration would need.
 *
 * Deliberately scoped to select/multi_select attributes: the aggregate itself
 * (`attributeValueBreakdown`) is field-type-agnostic, but text/number/date
 * values have no fixed label set for a bar list to summarize meaningfully.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { useLast30DaysRange } from './metric-tile'
import { attributeBreakdownQuery } from '@/lib/client/queries/support-reporting'
import { conversationAttributeQueries } from '@/lib/client/queries/conversation-attributes'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/shared/utils'

export function AttributeBreakdownCard() {
  const range = useLast30DaysRange()
  const { data: definitions } = useQuery(conversationAttributeQueries.live())
  const selectable = (definitions ?? []).filter(
    (d) => d.fieldType === 'select' || d.fieldType === 'multi_select'
  )
  const [chosenKey, setChosenKey] = useState<string | undefined>(undefined)
  // Default to the first selectable attribute once the registry loads.
  const activeKey = chosenKey ?? selectable[0]?.key

  const { data } = useQuery({
    ...attributeBreakdownQuery(activeKey ?? '', range.from, range.to),
    enabled: !!activeKey,
  })

  const def = selectable.find((d) => d.key === activeKey)
  const optionLabel = (value: string) => def?.options?.find((o) => o.id === value)?.label ?? value
  const total = (data?.values ?? []).reduce((sum, v) => sum + v.count, 0) + (data?.unset ?? 0)

  return (
    <SettingsCard
      title="Attribute breakdown"
      description="Conversation counts per attribute value over the last 30 days."
    >
      {selectable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No select-type conversation attributes yet — add one under Settings &gt; Conversation data
          to segment reporting by it.
        </p>
      ) : (
        <div className="space-y-3">
          <Select value={activeKey} onValueChange={setChosenKey}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Choose an attribute" />
            </SelectTrigger>
            <SelectContent>
              {selectable.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-1.5">
            {(data?.values ?? []).map((v) => (
              <BreakdownRow
                key={v.value}
                label={optionLabel(v.value)}
                count={v.count}
                total={total}
              />
            ))}
            {data && data.unset > 0 && (
              <BreakdownRow label="Not set" count={data.unset} total={total} muted />
            )}
            {data && total === 0 && (
              <p className="text-xs text-muted-foreground">No conversations in this window.</p>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function BreakdownRow({
  label,
  count,
  total,
  muted,
}: {
  label: string
  count: number
  total: number
  muted?: boolean
}) {
  const widthPct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn('w-32 shrink-0 truncate', muted && 'text-muted-foreground')}>
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${widthPct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{count}</span>
    </div>
  )
}

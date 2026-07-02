/**
 * Conditions builder. Edits a `{match: 'all'|'any', conditions: RoutingCondition[]}`
 * structure used by routing rules. Per-field value renderer adapts to the
 * selected field + op (string vs string[] when op === 'in').
 */
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TrashIcon, PlusIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

const FIELDS = [
  'subject',
  'descriptionText',
  'channel',
  'priority',
  'organizationDomain',
  'requesterEmail',
  'inboxChannelKind',
] as const
type Field = (typeof FIELDS)[number]

const OPS = ['eq', 'contains', 'matches', 'in'] as const
type Op = (typeof OPS)[number]

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const TICKET_CHANNELS = ['portal', 'email', 'api', 'widget'] as const
const INBOX_CHANNEL_KINDS = ['portal', 'email', 'api', 'widget', 'webhook'] as const

const FIELD_LABELS: Record<Field, string> = {
  subject: 'Subject',
  descriptionText: 'Description text',
  channel: 'Ticket channel',
  priority: 'Priority',
  organizationDomain: 'Organization domain',
  requesterEmail: 'Requester email',
  inboxChannelKind: 'Inbox channel kind',
}

export interface BuilderCondition {
  field: Field
  op: Op
  value: string | string[]
}

export interface BuilderRuleSet {
  match: 'all' | 'any'
  conditions: BuilderCondition[]
}

interface Props {
  value: BuilderRuleSet
  onChange: (next: BuilderRuleSet) => void
}

export function RoutingConditionsBuilder({ value, onChange }: Props) {
  const updateCondition = (idx: number, patch: Partial<BuilderCondition>) => {
    const next = value.conditions.map((c, i) => {
      if (i !== idx) return c
      const merged = { ...c, ...patch }
      // Normalize value shape when op flips between array (`in`) and scalar.
      if (patch.op !== undefined && patch.op !== c.op) {
        if (patch.op === 'in' && !Array.isArray(merged.value)) {
          merged.value = merged.value ? [merged.value] : []
        } else if (patch.op !== 'in' && Array.isArray(merged.value)) {
          merged.value = merged.value[0] ?? ''
        }
      }
      // When changing field, reset value to a sensible default for that field.
      if (patch.field !== undefined && patch.field !== c.field) {
        merged.value = merged.op === 'in' ? [] : ''
      }
      return merged
    })
    onChange({ ...value, conditions: next })
  }

  const addCondition = () => {
    onChange({
      ...value,
      conditions: [...value.conditions, { field: 'subject', op: 'contains', value: '' }],
    })
  }

  const removeCondition = (idx: number) => {
    onChange({
      ...value,
      conditions: value.conditions.filter((_, i) => i !== idx),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Match</span>
        <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
          {(['all', 'any'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...value, match: m })}
              className={cn(
                'px-2.5 py-1 text-xs',
                value.match === m
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              {m === 'all' ? 'All' : 'Any'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">of the following</span>
      </div>

      <div className="space-y-2">
        {value.conditions.map((c, idx) => (
          <div key={idx} className="grid grid-cols-[180px_140px_1fr_auto] gap-2 items-start">
            <Select
              value={c.field}
              onValueChange={(v) => updateCondition(idx, { field: v as Field })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={c.op} onValueChange={(v) => updateCondition(idx, { op: v as Op })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ConditionValueInput
              field={c.field}
              op={c.op}
              value={c.value}
              onChange={(v) => updateCondition(idx, { value: v })}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => removeCondition(idx)}
              aria-label="Remove condition"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addCondition}>
        <PlusIcon className="h-3.5 w-3.5 mr-1" />
        Add condition
      </Button>
    </div>
  )
}

function ConditionValueInput({
  field,
  op,
  value,
  onChange,
}: {
  field: Field
  op: Op
  value: string | string[]
  onChange: (v: string | string[]) => void
}) {
  const enumOptions =
    field === 'channel'
      ? (TICKET_CHANNELS as readonly string[])
      : field === 'priority'
        ? (PRIORITIES as readonly string[])
        : field === 'inboxChannelKind'
          ? (INBOX_CHANNEL_KINDS as readonly string[])
          : null

  // For `in` op on enum fields, render comma-separated select chips.
  if (op === 'in') {
    const arrVal = Array.isArray(value) ? value : value ? [value] : []
    if (enumOptions) {
      // Multi-toggle
      return (
        <div className="flex flex-wrap gap-1">
          {enumOptions.map((opt) => {
            const checked = arrVal.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  const next = checked ? arrVal.filter((v) => v !== opt) : [...arrVal, opt]
                  onChange(next)
                }}
                className={
                  'text-[11px] rounded border px-2 py-0.5 ' +
                  (checked
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border/60 text-muted-foreground hover:bg-muted')
                }
              >
                {opt}
              </button>
            )
          })}
        </div>
      )
    }
    // Free-text comma list for non-enum fields.
    return (
      <Input
        className="h-8 text-xs"
        value={arrVal.join(', ')}
        placeholder="value1, value2, …"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
      />
    )
  }

  // Scalar ops on enum fields → Select.
  if (enumOptions) {
    return (
      <Select value={typeof value === 'string' ? value : ''} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Pick value…" />
        </SelectTrigger>
        <SelectContent>
          {enumOptions.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Input
      className="h-8 text-xs"
      value={typeof value === 'string' ? value : ''}
      placeholder={op === 'matches' ? 'regex…' : 'value…'}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

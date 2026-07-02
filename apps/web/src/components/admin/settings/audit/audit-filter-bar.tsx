/**
 * Filter bar for the unified audit log. All controls drive a single
 * `AuditFilters` object; changes propagate up immediately and the underlying
 * infinite query resets its cursor when filters change.
 */
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'
import {
  auditQueries,
  defaultAuditFilters,
  rangeToFromIso,
  type AuditFilters,
  type AuditOriginFilter,
  type AuditSourceFilter,
  type AuditTimeRange,
} from '@/lib/client/queries/audit'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'

interface Props {
  value: AuditFilters
  onChange: (next: AuditFilters) => void
}

const SOURCES: AuditSourceFilter[] = ['web', 'api', 'integration', 'system', 'mcp']
const ALL = '__all__'
const ORIGINS: Array<{ label: string; value: AuditOriginFilter | typeof ALL }> = [
  { label: 'All', value: ALL },
  { label: 'Workspace', value: 'workspace' },
  { label: 'Security', value: 'security' },
]

const TIME_RANGES: Array<{ label: string; value: AuditTimeRange }> = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'All time', value: 'all' },
  { label: 'Custom', value: 'custom' },
]

function isoToLocal(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // Build YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localToIso(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  if (isNaN(d.getTime())) return undefined
  return d.toISOString()
}

export function AuditFilterBar({ value, onChange }: Props) {
  const actionsQuery = useQuery(auditQueries.actions())
  const actions = actionsQuery.data ?? []

  // Derive the "current action" string and the prefix-mode flag from the
  // incoming filter values so the controls round-trip cleanly.
  const currentAction = value.action ?? value.actionPrefix ?? ''
  const [prefixMode, setPrefixMode] = useState(Boolean(value.actionPrefix))

  const [timeRange, setTimeRange] = useState<AuditTimeRange>('30d')
  const [actorEmail, setActorEmail] = useState(value.actorEmail ?? '')
  const debouncedActorEmail = useDebouncedValue(actorEmail, 300)

  // Local text buffers so typing doesn't refetch every server query.
  const [targetType, setTargetType] = useState(value.targetType ?? '')
  const [targetId, setTargetId] = useState(value.targetId ?? '')

  useEffect(() => {
    setTargetType(value.targetType ?? '')
  }, [value.targetType])

  useEffect(() => {
    setTargetId(value.targetId ?? '')
  }, [value.targetId])

  useEffect(() => {
    setActorEmail(value.actorEmail ?? '')
  }, [value.actorEmail])

  useEffect(() => {
    const trimmed = debouncedActorEmail.trim()
    const next = trimmed || undefined
    if ((value.actorEmail ?? undefined) !== next) {
      onChange({ ...value, actorEmail: next })
    }
  }, [debouncedActorEmail, onChange, value])

  const setOrigin = (next: string) =>
    onChange({
      ...value,
      origin: next === ALL ? undefined : (next as AuditOriginFilter),
    })

  const setActor = (next: PrincipalId | null) => onChange({ ...value, principalId: next })

  const setAction = (next: string) => {
    const trimmed = next.trim()
    if (!trimmed) {
      onChange({ ...value, action: undefined, actionPrefix: undefined })
      return
    }
    if (prefixMode) onChange({ ...value, action: undefined, actionPrefix: trimmed })
    else onChange({ ...value, action: trimmed, actionPrefix: undefined })
  }

  const togglePrefix = (next: boolean) => {
    setPrefixMode(next)
    if (!currentAction) return
    if (next) onChange({ ...value, action: undefined, actionPrefix: currentAction })
    else onChange({ ...value, action: currentAction, actionPrefix: undefined })
  }

  const setSource = (next: string) =>
    onChange({
      ...value,
      source: next === ALL ? undefined : (next as AuditSourceFilter),
    })

  const setRange = (next: AuditTimeRange) => {
    setTimeRange(next)
    if (next === 'custom') return
    onChange({
      ...value,
      fromIso: rangeToFromIso(next),
      toIso: undefined,
    })
  }

  const setFrom = (local: string) => {
    setTimeRange('custom')
    onChange({ ...value, fromIso: localToIso(local) })
  }

  const setTo = (local: string) => {
    setTimeRange('custom')
    onChange({ ...value, toIso: localToIso(local) })
  }

  const commitTargetType = () => onChange({ ...value, targetType: targetType.trim() || undefined })
  const commitTargetId = () => onChange({ ...value, targetId: targetId.trim() || undefined })

  const clearAll = () => {
    setPrefixMode(false)
    setTargetType('')
    setTargetId('')
    setActorEmail('')
    setTimeRange('30d')
    onChange(defaultAuditFilters())
  }

  const hasFilters =
    Boolean(value.origin) ||
    Boolean(value.principalId) ||
    Boolean(value.actorEmail) ||
    Boolean(value.action) ||
    Boolean(value.actionPrefix) ||
    Boolean(value.targetType) ||
    Boolean(value.targetId) ||
    Boolean(value.source) ||
    Boolean(value.fromIso) ||
    Boolean(value.toIso)

  return (
    <div className="rounded-md border border-border/50 p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Origin</Label>
          <Select value={value.origin ?? ALL} onValueChange={setOrigin}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORIGINS.map((origin) => (
                <SelectItem key={origin.value} value={origin.value}>
                  {origin.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Actor principal</Label>
          <PrincipalPicker
            value={value.principalId ?? null}
            onValueChange={setActor}
            allowUnassigned
            placeholder="Any actor"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Action</Label>
          <div className="flex items-center gap-2">
            <Input
              list="audit-actions"
              value={currentAction}
              onChange={(e) => setAction(e.target.value)}
              placeholder={prefixMode ? 'e.g. ticket.' : 'e.g. ticket.created'}
              className="h-9"
            />
            <datalist id="audit-actions">
              {actions.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch id="audit-prefix-mode" checked={prefixMode} onCheckedChange={togglePrefix} />
            <Label htmlFor="audit-prefix-mode" className="text-[11px] font-normal">
              Match as prefix
            </Label>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Actor email</Label>
          <Input
            type="search"
            value={actorEmail}
            onChange={(e) => setActorEmail(e.target.value)}
            placeholder="name@example.com"
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Target type</Label>
          <Input
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            onBlur={commitTargetType}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitTargetType()
              }
            }}
            placeholder="e.g. ticket"
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Target ID</Label>
          <Input
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            onBlur={commitTargetId}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitTargetId()
              }
            }}
            placeholder="ticket_..."
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Source</Label>
          <Select value={value.source ?? ALL} onValueChange={setSource}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any</SelectItem>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Range</Label>
          <Select value={timeRange} onValueChange={(next) => setRange(next as AuditTimeRange)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="datetime-local"
            value={isoToLocal(value.fromIso)}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="datetime-local"
            value={isoToLocal(value.toIso)}
            onChange={(e) => setTo(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={clearAll} disabled={!hasFilters}>
          Clear filters
        </Button>
      </div>
    </div>
  )
}

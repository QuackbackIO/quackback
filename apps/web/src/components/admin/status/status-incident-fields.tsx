/**
 * Shared field components for the status incident composers: the
 * affected-services checklist (report/schedule dialogs + editor sidebar)
 * and the quiet template picker.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusSelect } from '@/components/shared/sidebar-primitives'
import {
  statusComponentQueries,
  statusTemplateQueries,
  type StatusComponentsAdmin,
} from '@/lib/client/queries/status'
import {
  COMPONENT_STATUS_OPTIONS,
  LIFECYCLE_COLORS,
  LIFECYCLE_LABELS,
  defaultAffectedStatus,
  type StatusComponentStatus,
  type StatusIncidentImpact,
  type StatusIncidentKind,
  type StatusIncidentLifecycle,
} from './status-admin-colors'

export interface AffectedRow {
  componentId: string
  componentStatus: StatusComponentStatus
}

interface FlatComponent {
  id: string
  name: string
  groupName: string | null
}

function flattenComponents(data: StatusComponentsAdmin | undefined): FlatComponent[] {
  if (!data) return []
  const flat: FlatComponent[] = []
  for (const group of data.groups) {
    for (const c of group.components) flat.push({ id: c.id, name: c.name, groupName: group.name })
  }
  for (const c of data.ungrouped) flat.push({ id: c.id, name: c.name, groupName: null })
  return flat
}

/** Checklist of services with an inline colored status picker for each
 *  checked row — shared by the create dialogs and the editor sidebar. */
export function AffectedComponentsField({
  kind,
  value,
  onChange,
}: {
  kind: StatusIncidentKind
  value: AffectedRow[]
  onChange: (next: AffectedRow[]) => void
}) {
  const { data, isLoading } = useQuery(statusComponentQueries.list())
  const components = useMemo(() => flattenComponents(data), [data])
  const byId = useMemo(() => new Map(value.map((v) => [v.componentId, v.componentStatus])), [value])

  function toggle(id: string) {
    if (byId.has(id)) {
      onChange(value.filter((v) => v.componentId !== id))
    } else {
      onChange([...value, { componentId: id, componentStatus: defaultAffectedStatus(kind) }])
    }
  }

  function setStatus(id: string, status: StatusComponentStatus) {
    onChange(value.map((v) => (v.componentId === id ? { ...v, componentStatus: status } : v)))
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading services…</p>
  if (components.length === 0) {
    return <p className="text-xs text-muted-foreground">No services yet — create one first.</p>
  }

  return (
    <div className="space-y-1 rounded-lg border border-border/50">
      {components.map((c) => {
        const status = byId.get(c.id)
        const checked = status !== undefined
        return (
          <div
            key={c.id}
            className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
          >
            <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
            <span className="flex-1 min-w-0 truncate text-sm">
              {c.name}
              {c.groupName && (
                <span className="ml-1.5 text-xs text-muted-foreground">· {c.groupName}</span>
              )}
            </span>
            {checked && (
              <StatusSelect
                value={status}
                options={COMPONENT_STATUS_OPTIONS}
                onChange={(v) => setStatus(c.id, v as StatusComponentStatus)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export interface TemplateApplyPayload {
  title: string
  body: string
  impact: StatusIncidentImpact
  componentIds: string[]
}

/** Quiet popover trigger for applying a template — sits on a field label
 *  row without competing with the fields themselves. Renders nothing when
 *  no templates exist. */
export function TemplatePickerButton({
  label,
  onApply,
}: {
  label: string
  onApply: (template: TemplateApplyPayload) => void
}) {
  const { data: templates } = useQuery(statusTemplateQueries.list())
  const [open, setOpen] = useState(false)
  if (!templates || templates.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <DocumentTextIcon className="h-3.5 w-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onApply(t)
              setOpen(false)
            }}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 transition-colors"
          >
            <span className="block font-medium">{t.name}</span>
            <span className="block text-xs text-muted-foreground truncate">{t.title}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** The uppercase colored lifecycle label used by list rows, overview cards,
 *  and the editor timeline header. */
export function LifecycleBadge({ status }: { status: StatusIncidentLifecycle }) {
  return (
    <span
      className="font-semibold uppercase tracking-wide text-[11px]"
      style={{ color: LIFECYCLE_COLORS[status] }}
    >
      {LIFECYCLE_LABELS[status]}
    </span>
  )
}

/** Map a template's component ids onto affected rows with the kind's
 *  default status — shared by both create dialogs. */
export function templateToAffectedRows(
  componentIds: string[],
  kind: StatusIncidentKind
): AffectedRow[] {
  return componentIds.map((id) => ({
    componentId: id,
    componentStatus: defaultAffectedStatus(kind),
  }))
}

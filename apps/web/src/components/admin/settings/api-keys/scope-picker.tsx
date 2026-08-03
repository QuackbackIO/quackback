/**
 * Grouped checkbox grid for selecting API key permission scopes.
 *
 * Renders the workspace's `PERMISSION_CATEGORIES` map. Each category gets a
 * "Select all / Clear" header. Each row shows a humanized label plus the
 * dotted permission key in `<code>` for auditability.
 */
import { useMemo } from 'react'
import { PERMISSION_CATEGORIES, type PermissionKey } from '@/lib/server/domains/authz'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  ticket: 'Tickets',
  org: 'Organizations',
  sla: 'SLA',
  audit: 'Audit',
  inbox: 'Inboxes & routing',
  admin: 'Admin',
  team: 'Teams',
  audience: 'Audience & segments',
  portal: 'Portal & widget',
  chat: 'Conversations',
  moderation: 'Moderation',
}

function humanize(key: string): string {
  // e.g. "ticket.view_all" → "View all"
  const right = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key
  const words = right.split('_')
  if (words.length === 0) return right
  const first = words[0]
  const head = first.charAt(0).toUpperCase() + first.slice(1)
  return [head, ...words.slice(1)].join(' ')
}

export function ScopePicker({ value, onChange, disabled }: Props) {
  const selected = useMemo(() => new Set(value), [value])

  const toggle = (key: PermissionKey) => {
    if (selected.has(key)) {
      onChange(value.filter((v) => v !== key))
    } else {
      onChange([...value, key])
    }
  }

  const setCategory = (perms: readonly PermissionKey[], allOn: boolean) => {
    const without = value.filter((v) => !perms.includes(v as PermissionKey))
    if (allOn) onChange(without)
    else onChange([...without, ...perms])
  }

  return (
    <div className="rounded-md border border-border/50 divide-y divide-border/50">
      {Object.entries(PERMISSION_CATEGORIES).map(([cat, perms]) => {
        const allOn = perms.every((p) => selected.has(p))
        const someOn = perms.some((p) => selected.has(p))
        return (
          <div key={cat} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[cat] ?? cat}
                {someOn && (
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    {perms.filter((p) => selected.has(p)).length}/{perms.length}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => setCategory(perms, allOn)}
                disabled={disabled}
              >
                {allOn ? 'Clear' : 'Select all'}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {perms.map((p) => {
                const id = `scope-${p}`
                const checked = selected.has(p)
                return (
                  <label
                    key={p}
                    htmlFor={id}
                    className="flex items-start gap-2 text-xs cursor-pointer select-none"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={() => toggle(p)}
                      disabled={disabled}
                    />
                    <span className="flex flex-col min-w-0">
                      <span>{humanize(p)}</span>
                      <code className="text-[10px] text-muted-foreground truncate">{p}</code>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

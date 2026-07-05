/**
 * Admin manager for macros (support platform §4.6) — the surface that replaces
 * the old "Saved replies" editor on the Conversations settings page. Lists the
 * workspace's macros and opens a dialog to create/edit one: name, scope, a body
 * with a variables helper row, and a builder for the bundled actions.
 *
 * Only the actions a conversation service can actually run are offered here
 * (assign agent, assign team, add tag, set priority, snooze, close, set
 * attribute). set_attribute pairs a definition picker with a typed value
 * input; the apply path validates against the definition and records the
 * invoking agent as the writer.
 */
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon, TrashIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { MacroId } from '@quackback/ids'
import type { MacroAction, MacroScope } from '@/lib/shared/db-types'
import { macrosQuery } from '@/lib/client/queries/macros'
import { useCreateMacro, useUpdateMacro, useDeleteMacro } from '@/lib/client/mutations/macros'
import { fetchConversationTagsFn } from '@/lib/server/functions/conversation-tags'
import { conversationAttributeQueries } from '@/lib/client/queries/conversation-attributes'
import { AttributeValueInput } from './attribute-value-input'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useInboxTeams } from '@/components/admin/conversation/inbox-nav-sidebar'
import { MACRO_VARIABLES } from '@/lib/shared/conversation/macros'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface MacroRow {
  id: MacroId
  name: string
  body: string
  scope: MacroScope
  actions: MacroAction[]
}

const SCOPE_LABELS: Record<MacroScope, string> = {
  support: 'Support',
  feedback: 'Feedback',
  both: 'Both',
}

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
const SNOOZE_PRESETS = [
  { value: 'until_reply', label: 'Until they reply' },
  { value: 'tomorrow', label: 'Until tomorrow' },
  { value: 'next_week', label: 'Until next week' },
] as const

/** Action shapes offered in the builder (the ones a service actually applies). */
const ACTION_TYPES = [
  { value: 'assign_agent', label: 'Assign to agent' },
  { value: 'assign_team', label: 'Assign to team' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'set_priority', label: 'Set priority' },
  { value: 'snooze', label: 'Snooze' },
  { value: 'close', label: 'Close conversation' },
  { value: 'set_attribute', label: 'Set attribute' },
] as const

type OfferedActionType = (typeof ACTION_TYPES)[number]['value']

/** A fresh action of the given type with sensible defaults. */
function defaultAction(type: OfferedActionType): MacroAction {
  switch (type) {
    case 'assign_agent':
      return { type: 'assign_agent', principalId: '' }
    case 'assign_team':
      return { type: 'assign_team', teamId: '' }
    case 'add_tag':
      return { type: 'add_tag', tagId: '' }
    case 'set_priority':
      return { type: 'set_priority', priority: 'medium' }
    case 'snooze':
      return { type: 'snooze', preset: 'until_reply' }
    case 'close':
      return { type: 'close' }
    case 'set_attribute':
      return { type: 'set_attribute', key: '', value: null }
  }
}

export function MacrosManager() {
  const { data } = useQuery(macrosQuery())
  const macros = (data?.macros ?? []) as MacroRow[]
  const [editing, setEditing] = useState<MacroRow | 'new' | null>(null)
  const deleteMacro = useDeleteMacro()

  return (
    <div className="space-y-3">
      {macros.length === 0 && <p className="text-sm text-muted-foreground">No macros yet.</p>}
      {macros.map((macro) => (
        <div
          key={macro.id}
          className="flex items-start gap-2 rounded-lg border border-border/60 p-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{macro.name}</span>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {SCOPE_LABELS[macro.scope]}
              </Badge>
              {macro.actions.length > 0 && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {macro.actions.length} action{macro.actions.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{macro.body}</p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(macro)}
            className="mt-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Edit macro"
          >
            <PencilSquareIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              deleteMacro.mutate(macro.id, {
                onSuccess: () => toast.success('Macro deleted'),
                onError: () => toast.error('Failed to delete macro'),
              })
            }}
            disabled={deleteMacro.isPending}
            className="mt-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
            aria-label="Delete macro"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setEditing('new')}>
        <PlusIcon className="h-4 w-4" /> Add macro
      </Button>
      {editing && (
        <MacroEditorDialog
          macro={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function MacroEditorDialog({ macro, onClose }: { macro: MacroRow | null; onClose: () => void }) {
  const create = useCreateMacro()
  const update = useUpdateMacro()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [name, setName] = useState(macro?.name ?? '')
  const [scope, setScope] = useState<MacroScope>(macro?.scope ?? 'support')
  const [body, setBody] = useState(macro?.body ?? '')
  const [actions, setActions] = useState<MacroAction[]>(macro?.actions ?? [])

  const { data: members } = useTeamMembers()
  const { data: tags } = useQuery({
    queryKey: ['admin', 'conversation-tags', 'all'],
    queryFn: () => fetchConversationTagsFn(),
    staleTime: 60_000,
  })
  const { data: teams } = useInboxTeams()
  const { data: attributeDefs } = useQuery(conversationAttributeQueries.live())

  const saving = create.isPending || update.isPending

  function insertVariable(variable: string) {
    const el = bodyRef.current
    const token = `{${variable}}`
    if (!el) {
      setBody((b) => b + token)
      return
    }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    setBody(body.slice(0, start) + token + body.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + token.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  function updateAction(index: number, next: MacroAction) {
    setActions((prev) => prev.map((a, i) => (i === index ? next : a)))
  }

  function save() {
    const trimmedName = name.trim()
    if (!trimmedName || !body.trim()) {
      toast.error('Name and body are required')
      return
    }
    // Drop rows the admin left unfilled (no agent/tag/attribute chosen).
    const cleanedActions = actions.filter((a) => {
      if (a.type === 'assign_agent') return Boolean(a.principalId)
      if (a.type === 'assign_team') return Boolean(a.teamId)
      if (a.type === 'add_tag') return Boolean(a.tagId)
      if (a.type === 'set_attribute') return Boolean(a.key)
      return true
    })
    const input = { name: trimmedName, body, scope, actions: cleanedActions }
    const opts = {
      onSuccess: () => {
        toast.success(macro ? 'Macro updated' : 'Macro created')
        onClose()
      },
      onError: () => toast.error('Failed to save macro'),
    }
    if (macro) update.mutate({ id: macro.id, ...input }, opts)
    else create.mutate(input, opts)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{macro ? 'Edit macro' : 'New macro'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="macro-name">Name</Label>
            <Input
              id="macro-name"
              value={name}
              maxLength={80}
              placeholder="e.g. Password reset"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as MacroScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="feedback">Feedback</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="macro-body">Body</Label>
            <Textarea
              id="macro-body"
              ref={bodyRef}
              value={body}
              maxLength={4000}
              rows={4}
              placeholder="Hi {firstName}, thanks for reaching out…"
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              <span className="text-[11px] text-muted-foreground">Insert:</span>
              {MACRO_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/70"
                >
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Actions</Label>
            {actions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No actions. The macro just inserts its text.
              </p>
            )}
            {actions.map((action, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={action.type}
                  onValueChange={(v) => updateAction(i, defaultAction(v as OfferedActionType))}
                >
                  <SelectTrigger className="w-40 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {action.type === 'assign_agent' && (
                  <EntitySelect
                    value={action.principalId}
                    placeholder="Choose agent"
                    items={(members ?? []).map((m) => ({ id: m.id, name: m.name }))}
                    onChange={(v) => updateAction(i, { type: 'assign_agent', principalId: v })}
                  />
                )}

                {action.type === 'assign_team' && (
                  <EntitySelect
                    value={action.teamId}
                    placeholder="Choose team"
                    items={(teams ?? []).map((t) => ({ id: t.id, name: t.name }))}
                    onChange={(v) => updateAction(i, { type: 'assign_team', teamId: v })}
                  />
                )}

                {action.type === 'add_tag' && (
                  <EntitySelect
                    value={action.tagId}
                    placeholder="Choose tag"
                    items={(tags ?? []).map((t) => ({ id: t.id, name: t.name }))}
                    onChange={(v) => updateAction(i, { type: 'add_tag', tagId: v })}
                  />
                )}

                {action.type === 'set_priority' && (
                  <Select
                    value={action.priority}
                    onValueChange={(v) =>
                      updateAction(i, {
                        type: 'set_priority',
                        priority: v as (typeof PRIORITIES)[number],
                      })
                    }
                  >
                    <SelectTrigger className="flex-1 capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p} className="capitalize">
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {action.type === 'snooze' && (
                  <Select
                    value={action.preset}
                    onValueChange={(v) =>
                      updateAction(i, {
                        type: 'snooze',
                        preset: v as (typeof SNOOZE_PRESETS)[number]['value'],
                      })
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SNOOZE_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {action.type === 'close' && <div className="flex-1" />}

                {action.type === 'set_attribute' && (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <EntitySelect
                      value={action.key}
                      placeholder="Choose attribute"
                      items={(attributeDefs ?? []).map((d) => ({ id: d.key, name: d.label }))}
                      onChange={(key) =>
                        // Reset the value on a definition switch: types differ.
                        updateAction(i, { type: 'set_attribute', key, value: null })
                      }
                    />
                    {(() => {
                      const def = (attributeDefs ?? []).find((d) => d.key === action.key)
                      return def ? (
                        <AttributeValueInput
                          definition={def}
                          value={action.value}
                          onChange={(value) =>
                            updateAction(i, { type: 'set_attribute', key: action.key, value })
                          }
                          className="min-w-0 flex-1"
                        />
                      ) : null
                    })()}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  aria-label="Remove action"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActions((prev) => [...prev, defaultAction('assign_agent')])}
            >
              <PlusIcon className="h-4 w-4" /> Add action
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {macro ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The entity picker shared by the assign-agent / assign-team / add-tag actions. */
function EntitySelect({
  value,
  placeholder,
  items,
  onChange,
}: {
  value: string
  placeholder: string
  items: Array<{ id: string; name: string | null }>
  onChange: (id: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="flex-1">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.id} value={it.id}>
            {it.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

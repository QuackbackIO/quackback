import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import type { ConversationViewId } from '@quackback/ids'
import {
  createConversationViewFn,
  updateConversationViewFn,
} from '@/lib/server/functions/conversation-views'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import {
  CONVERSATION_SORTS,
  CONVERSATION_SORT_LABELS,
  CONVERSATION_VIEW_RULE_FIELDS,
  TICKET_VIEW_RULE_FIELDS,
  MAX_VIEW_RULES,
  conversationViewFiltersSchema,
  type ConversationSort,
  type ConversationViewDTO,
  type ConversationViewRuleField,
} from '@/lib/shared/conversation/views'
import { TICKET_TYPES, TICKET_STATUS_CATEGORIES, TICKET_STAGES } from '@/lib/shared/db-types'
import { TICKET_STATUS_CATEGORY_LABELS, DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import { ticketTypeLabel } from '@/components/admin/inbox/ticket-chips'
import {
  useConversationTagsWithCounts,
  useInboxTeams,
  useSupportTicketsEnabled,
} from '@/components/admin/conversation/inbox-nav-sidebar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// A rule while being edited: value may be blank until the teammate picks one.
type DraftRule = { field: ConversationViewRuleField; value: string }

const FIELD_LABELS: Record<ConversationViewRuleField, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  team: 'Team',
  tag: 'Tag',
  source: 'Channel',
  waiting: 'Waiting',
  kind: 'Item kind',
  ticket_type: 'Ticket type',
  ticket_status_category: 'Ticket status',
  ticket_stage: 'Ticket stage',
}

const STATUS_OPTIONS = ['open', 'snoozed', 'closed']
const PRIORITY_OPTIONS = ['none', 'low', 'medium', 'high', 'urgent']
const ASSIGNEE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'me', label: 'Me' },
  { value: 'unassigned', label: 'Unassigned' },
]
const SOURCE_OPTIONS = ['widget', 'email']
const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'conversation', label: 'Conversation' },
  { value: 'ticket', label: 'Ticket' },
]
const TICKET_TYPE_OPTIONS: Array<{ value: string; label: string }> = TICKET_TYPES.map((t) => ({
  value: t,
  label: ticketTypeLabel(t),
}))
const TICKET_STATUS_CATEGORY_OPTIONS: Array<{ value: string; label: string }> =
  TICKET_STATUS_CATEGORIES.map((c) => ({ value: c, label: TICKET_STATUS_CATEGORY_LABELS[c] }))
const TICKET_STAGE_OPTIONS: Array<{ value: string; label: string }> = TICKET_STAGES.map((s) => ({
  value: s,
  label: DEFAULT_TICKET_STAGE_LABELS[s],
}))

/** The default value for a freshly-picked field (so a new row is valid at once). */
function defaultValueFor(field: ConversationViewRuleField): string {
  switch (field) {
    case 'status':
      return 'open'
    case 'priority':
      return 'high'
    case 'assignee':
      return 'me'
    case 'source':
      return 'widget'
    case 'waiting':
      return 'true'
    case 'kind':
      return 'ticket'
    case 'ticket_type':
      return 'customer'
    case 'ticket_status_category':
      return 'open'
    case 'ticket_stage':
      return TICKET_STAGES[0]
    // team + tag depend on the loaded lists; the picker fills them in.
    default:
      return ''
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The view being edited, or null/undefined to create a new one. */
  editing?: ConversationViewDTO | null
  /** Called after a successful create/update with the view id (route selects it). */
  onSaved?: (viewId: ConversationViewId) => void
}

/**
 * Create / edit a custom saved inbox view (support platform §4.6): a name, a
 * rule-row builder (cap 15 rules), a sort, and a shared toggle. Running the view
 * (rules → list filter) happens in the route; this dialog only defines it.
 */
export function ConversationViewDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const queryClient = useQueryClient()
  const { data: tags } = useConversationTagsWithCounts()
  const { data: teams } = useInboxTeams()
  const supportTickets = useSupportTicketsEnabled()
  // Ticket-only rule fields (§2.8) are hidden from the picker when the
  // workspace hasn't turned tickets on — an existing view already carrying
  // one still runs (the schema/translation don't gate on the flag), it just
  // can't be re-picked from a fresh row.
  const visibleFields = CONVERSATION_VIEW_RULE_FIELDS.filter(
    (f) => supportTickets || !(TICKET_VIEW_RULE_FIELDS as readonly string[]).includes(f)
  )

  const [name, setName] = useState('')
  const [rules, setRules] = useState<DraftRule[]>([])
  const [sort, setSort] = useState<ConversationSort | ''>('')
  const [isShared, setIsShared] = useState(true)

  // Seed from the edited view on open (or reset for a create).
  useEffect(() => {
    if (!open) return
    if (editing) {
      setName(editing.name)
      setRules(editing.filters.rules.map((r) => ({ field: r.field, value: String(r.value) })))
      setSort(editing.sort ?? '')
      setIsShared(editing.isShared)
    } else {
      setName('')
      setRules([{ field: 'status', value: 'open' }])
      setSort('')
      setIsShared(true)
    }
  }, [open, editing])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentViews() })
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentConversations() })
  }

  const save = useMutation({
    mutationFn: async () => {
      // Build + validate the rule set (drops rows with no value, e.g. an empty
      // tag/team picker); the zod schema is the same one the server enforces.
      const parsed = conversationViewFiltersSchema.safeParse({
        rules: rules
          .filter((r) => r.value !== '')
          .map((r) => (r.field === 'waiting' ? { field: 'waiting', value: true } : r)),
      })
      if (!parsed.success) throw new Error('This view has an invalid rule')
      const filters = parsed.data
      const sortValue = sort === '' ? null : sort
      if (editing) {
        await updateConversationViewFn({
          data: { id: editing.id, name: name.trim(), filters, sort: sortValue, isShared },
        })
        return editing.id
      }
      const res = await createConversationViewFn({
        data: { name: name.trim(), filters, sort: sortValue, isShared },
      })
      return res.id
    },
    onSuccess: (viewId) => {
      invalidate()
      toast.success(editing ? 'View updated' : 'View created')
      onOpenChange(false)
      onSaved?.(viewId)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save view')
    },
  })

  const canSave = name.trim().length > 0 && !save.isPending

  const setRuleField = (i: number, field: ConversationViewRuleField) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { field, value: defaultValueFor(field) } : r)))
  const setRuleValue = (i: number, value: string) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, value } : r)))
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i))
  const addRule = () =>
    setRules((rs) =>
      rs.length >= MAX_VIEW_RULES ? rs : [...rs, { field: 'status', value: 'open' }]
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit view' : 'New view'}</DialogTitle>
          <DialogDescription>
            A saved set of filters over the inbox. Shared views are visible to the whole team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Urgent & unassigned"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Rules</Label>
            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={rule.field}
                    onValueChange={(v) => setRuleField(i, v as ConversationViewRuleField)}
                  >
                    <SelectTrigger className="w-32 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleFields.map((f) => (
                        <SelectItem key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <RuleValue
                    rule={rule}
                    tags={(tags ?? []).map((t) => ({ id: t.id, name: t.name }))}
                    teams={(teams ?? []).map((t) => ({ id: t.id, name: t.name }))}
                    onChange={(v) => setRuleValue(i, v)}
                  />
                  <button
                    type="button"
                    onClick={() => removeRule(i)}
                    aria-label="Remove rule"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            {rules.length < MAX_VIEW_RULES && (
              <button
                type="button"
                onClick={addRule}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <PlusIcon className="size-3.5" /> Add rule
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="view-sort" className="shrink-0">
              Sort
            </Label>
            <Select value={sort || 'recent'} onValueChange={(v) => setSort(v as ConversationSort)}>
              <SelectTrigger id="view-sort" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONVERSATION_SORTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CONVERSATION_SORT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="view-shared">Shared with the team</Label>
              <p className="text-xs text-muted-foreground">
                Off keeps the view visible only to you.
              </p>
            </div>
            <Switch id="view-shared" checked={isShared} onCheckedChange={setIsShared} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create view'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The value control for one rule row — switches on the rule's field. */
function RuleValue({
  rule,
  tags,
  teams,
  onChange,
}: {
  rule: DraftRule
  tags: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
  onChange: (value: string) => void
}) {
  if (rule.field === 'waiting') {
    return <span className="flex-1 text-xs text-muted-foreground">is waiting on a reply</span>
  }
  const options: Array<{ value: string; label: string }> =
    rule.field === 'status'
      ? STATUS_OPTIONS.map((v) => ({ value: v, label: v }))
      : rule.field === 'priority'
        ? PRIORITY_OPTIONS.map((v) => ({ value: v, label: v }))
        : rule.field === 'assignee'
          ? ASSIGNEE_OPTIONS
          : rule.field === 'source'
            ? SOURCE_OPTIONS.map((v) => ({ value: v, label: v }))
            : rule.field === 'tag'
              ? tags.map((t) => ({ value: t.id, label: t.name }))
              : rule.field === 'kind'
                ? KIND_OPTIONS
                : rule.field === 'ticket_type'
                  ? TICKET_TYPE_OPTIONS
                  : rule.field === 'ticket_status_category'
                    ? TICKET_STATUS_CATEGORY_OPTIONS
                    : rule.field === 'ticket_stage'
                      ? TICKET_STAGE_OPTIONS
                      : teams.map((t) => ({ value: t.id, label: t.name }))

  const empty = options.length === 0
  return (
    <Select value={rule.value} onValueChange={onChange} disabled={empty}>
      <SelectTrigger className="min-w-0 flex-1 capitalize">
        <SelectValue placeholder={empty ? 'None available' : 'Choose…'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="capitalize">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

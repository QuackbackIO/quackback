/**
 * Routing rule editor — Sheet drawer used for both create and edit. When `rule`
 * is provided, prefills + calls update; otherwise calls create. Conditions and
 * actions are jsonb on the server; the builders below shape them.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { InboxId, RoutingRuleId } from '@quackback/ids'
import type { RoutingRule } from '@/lib/shared/db-types'
import { createRoutingRuleFn, updateRoutingRuleFn } from '@/lib/server/functions/routing'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import {
  RoutingConditionsBuilder,
  type BuilderRuleSet,
  type BuilderCondition,
} from './routing-conditions-builder'
import { RoutingActionsBuilder, type BuilderAction } from './routing-actions-builder'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule?: RoutingRule
}

const DEFAULT_RULE_SET: BuilderRuleSet = {
  match: 'all',
  conditions: [{ field: 'subject', op: 'contains', value: '' }],
}
const DEFAULT_ACTIONS: BuilderAction[] = [{ type: 'assignToInbox', value: '' }]

export function RoutingRuleEditorSheet({ open, onOpenChange, rule }: Props) {
  const qc = useQueryClient()
  const isEdit = Boolean(rule)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopeMode, setScopeMode] = useState<'workspace' | 'inbox'>('workspace')
  const [inboxScope, setInboxScope] = useState<InboxId | null>(null)
  const [priority, setPriority] = useState<number>(100)
  const [enabled, setEnabled] = useState(true)
  const [ruleSet, setRuleSet] = useState<BuilderRuleSet>(DEFAULT_RULE_SET)
  const [actions, setActions] = useState<BuilderAction[]>(DEFAULT_ACTIONS)

  // Prefill / reset when sheet opens or rule changes.
  useEffect(() => {
    if (!open) return
    if (rule) {
      setName(rule.name)
      setDescription(rule.description ?? '')
      setScopeMode(rule.inboxIdScope ? 'inbox' : 'workspace')
      setInboxScope((rule.inboxIdScope as InboxId | null) ?? null)
      setPriority(rule.priority)
      setEnabled(rule.enabled)
      const rsRaw = rule.conditions as {
        match?: 'all' | 'any'
        conditions?: BuilderCondition[]
      } | null
      setRuleSet({
        match: rsRaw?.match ?? 'all',
        conditions:
          rsRaw?.conditions && rsRaw.conditions.length > 0
            ? rsRaw.conditions
            : DEFAULT_RULE_SET.conditions,
      })
      const aRaw = (rule.actions as BuilderAction[] | null) ?? []
      setActions(aRaw.length > 0 ? aRaw : DEFAULT_ACTIONS)
    } else {
      setName('')
      setDescription('')
      setScopeMode('workspace')
      setInboxScope(null)
      setPriority(100)
      setEnabled(true)
      setRuleSet(DEFAULT_RULE_SET)
      setActions(DEFAULT_ACTIONS)
    }
  }, [open, rule])

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required'
    if (scopeMode === 'inbox' && !inboxScope) return 'Pick an inbox or switch to workspace scope'
    if (ruleSet.conditions.length === 0) return 'At least one condition is required'
    for (const c of ruleSet.conditions) {
      if (Array.isArray(c.value) ? c.value.length === 0 : !c.value) {
        return `Condition on "${c.field}" is missing a value`
      }
    }
    if (actions.length === 0) return 'At least one action is required'
    for (const a of actions) {
      if (!a.value) return `Action "${a.type}" is missing a value`
    }
    return null
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createRoutingRuleFn({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          priority,
          enabled,
          conditions: ruleSet,
          actions,
          inboxIdScope: scopeMode === 'inbox' ? inboxScope : null,
        },
      }),
    onSuccess: () => {
      toast.success('Routing rule created')
      qc.invalidateQueries({ queryKey: ['routing-rules'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateRoutingRuleFn({
        data: {
          ruleId: rule!.id as RoutingRuleId,
          name: name.trim(),
          description: description.trim() || null,
          priority,
          enabled,
          conditions: ruleSet,
          actions,
          inboxIdScope: scopeMode === 'inbox' ? inboxScope : null,
        },
      }),
    onSuccess: () => {
      toast.success('Routing rule updated')
      qc.invalidateQueries({ queryKey: ['routing-rules'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    if (isEdit) updateMutation.mutate()
    else createMutation.mutate()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit routing rule' : 'New routing rule'}</SheetTitle>
          <SheetDescription>
            Conditions are evaluated against incoming tickets; matching rules apply their actions in
            order.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-4 px-4">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Basics
            </h3>
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Urgent VIP tickets → tier 2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-desc">Description</Label>
              <Textarea
                id="rule-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select
                  value={scopeMode}
                  onValueChange={(v) => setScopeMode(v as 'workspace' | 'inbox')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace">Workspace-wide</SelectItem>
                    <SelectItem value="inbox">Specific inbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-priority">Priority</Label>
                <Input
                  id="rule-priority"
                  type="number"
                  min={0}
                  max={1_000_000}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            {scopeMode === 'inbox' && (
              <div className="space-y-2">
                <Label>Inbox</Label>
                <InboxPicker
                  value={inboxScope}
                  onValueChange={setInboxScope}
                  allowClear
                  placeholder="Pick inbox…"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="rule-enabled" />
              <Label htmlFor="rule-enabled" className="text-xs cursor-pointer">
                Enabled
              </Label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conditions
            </h3>
            <RoutingConditionsBuilder value={ruleSet} onChange={setRuleSet} />
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Actions
            </h3>
            <RoutingActionsBuilder value={actions} onChange={setActions} />
          </section>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isEdit ? 'Save changes' : 'Create rule'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

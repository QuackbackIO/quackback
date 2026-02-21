'use client'

import { useState, useEffect } from 'react'
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { cn } from '@/lib/shared/utils'
import type { SegmentId } from '@quackback/ids'

// ============================================
// Preset colors
// ============================================

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6b7280', // gray
]

// ============================================
// Rule types
// ============================================

type RuleAttribute =
  | 'email_domain'
  | 'email_verified'
  | 'created_at_days_ago'
  | 'post_count'
  | 'vote_count'
  | 'comment_count'
  | 'plan'
  | 'metadata_key'

type RuleOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'

export interface RuleCondition {
  attribute: RuleAttribute
  operator: RuleOperator
  value: string
  metadataKey?: string
}

const ATTRIBUTE_OPTIONS: { value: RuleAttribute; label: string }[] = [
  { value: 'email_domain', label: 'Email Domain' },
  { value: 'email_verified', label: 'Email Verified' },
  { value: 'created_at_days_ago', label: 'Days Since Joined' },
  { value: 'post_count', label: 'Post Count' },
  { value: 'vote_count', label: 'Vote Count' },
  { value: 'comment_count', label: 'Comment Count' },
  { value: 'plan', label: 'Plan (metadata)' },
  { value: 'metadata_key', label: 'Custom Metadata Key' },
]

const OPERATOR_OPTIONS: Record<RuleAttribute, { value: RuleOperator; label: string }[]> = {
  email_domain: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'ends_with', label: 'ends with' },
  ],
  email_verified: [{ value: 'eq', label: 'is' }],
  created_at_days_ago: [
    { value: 'gt', label: 'more than (days ago)' },
    { value: 'lt', label: 'less than (days ago)' },
    { value: 'gte', label: 'at least (days ago)' },
    { value: 'lte', label: 'at most (days ago)' },
  ],
  post_count: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
  ],
  vote_count: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
  ],
  comment_count: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
  ],
  plan: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
  ],
  metadata_key: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' },
  ],
}

// ============================================
// Rule condition row
// ============================================

function RuleConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: RuleCondition
  onChange: (updated: RuleCondition) => void
  onRemove: () => void
}) {
  const operators = OPERATOR_OPTIONS[condition.attribute] ?? []
  const isNumeric = ['created_at_days_ago', 'post_count', 'vote_count', 'comment_count'].includes(
    condition.attribute
  )
  const isBoolean = condition.attribute === 'email_verified'

  return (
    <div className="flex items-start gap-2">
      {/* Attribute */}
      <Select
        value={condition.attribute}
        onValueChange={(val) =>
          onChange({
            ...condition,
            attribute: val as RuleAttribute,
            operator: (OPERATOR_OPTIONS[val as RuleAttribute]?.[0]?.value ?? 'eq') as RuleOperator,
            value: '',
          })
        }
      >
        <SelectTrigger className="h-8 text-xs w-[160px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ATTRIBUTE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select
        value={condition.operator}
        onValueChange={(val) => onChange({ ...condition, operator: val as RuleOperator })}
      >
        <SelectTrigger className="h-8 text-xs w-[130px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Metadata key (only for metadata_key attribute) */}
      {condition.attribute === 'metadata_key' && (
        <Input
          className="h-8 text-xs w-[100px] shrink-0"
          placeholder="key"
          value={condition.metadataKey ?? ''}
          onChange={(e) => onChange({ ...condition, metadataKey: e.target.value })}
        />
      )}

      {/* Value */}
      {isBoolean ? (
        <Select
          value={condition.value || 'true'}
          onValueChange={(val) => onChange({ ...condition, value: val })}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">
              True
            </SelectItem>
            <SelectItem value="false" className="text-xs">
              False
            </SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="h-8 text-xs flex-1"
          type={isNumeric ? 'number' : 'text'}
          placeholder={isNumeric ? '0' : 'value'}
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      )}

      {/* Remove */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <XMarkIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ============================================
// Rule builder
// ============================================

function RuleBuilder({
  match,
  conditions,
  onMatchChange,
  onConditionsChange,
}: {
  match: 'all' | 'any'
  conditions: RuleCondition[]
  onMatchChange: (v: 'all' | 'any') => void
  onConditionsChange: (v: RuleCondition[]) => void
}) {
  const handleAdd = () => {
    onConditionsChange([...conditions, { attribute: 'email_domain', operator: 'eq', value: '' }])
  }

  const handleChange = (idx: number, updated: RuleCondition) => {
    const next = [...conditions]
    next[idx] = updated
    onConditionsChange(next)
  }

  const handleRemove = (idx: number) => {
    onConditionsChange(conditions.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      {/* Match type */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Users must match</span>
        <Select value={match} onValueChange={(v) => onMatchChange(v as 'all' | 'any')}>
          <SelectTrigger className="h-7 w-[60px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              ALL
            </SelectItem>
            <SelectItem value="any" className="text-xs">
              ANY
            </SelectItem>
          </SelectContent>
        </Select>
        <span>of these conditions:</span>
      </div>

      {/* Conditions */}
      <div className="space-y-2">
        {conditions.map((cond, idx) => (
          <RuleConditionRow
            key={idx}
            condition={cond}
            onChange={(updated) => handleChange(idx, updated)}
            onRemove={() => handleRemove(idx)}
          />
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={handleAdd}>
        <PlusIcon className="h-3.5 w-3.5 mr-1" />
        Add condition
      </Button>
    </div>
  )
}

// ============================================
// Segment form dialog
// ============================================

export interface SegmentFormValues {
  name: string
  description: string
  type: 'manual' | 'dynamic'
  color: string
  rules: {
    match: 'all' | 'any'
    conditions: RuleCondition[]
  }
}

interface SegmentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: Partial<SegmentFormValues> & { id?: SegmentId }
  onSubmit: (values: SegmentFormValues) => Promise<void>
  isPending?: boolean
}

export function SegmentFormDialog({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  isPending,
}: SegmentFormDialogProps) {
  const isEditing = !!initialValues?.id

  const [name, setName] = useState(initialValues?.name ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [type, setType] = useState<'manual' | 'dynamic'>(initialValues?.type ?? 'manual')
  const [color, setColor] = useState(initialValues?.color ?? '#6366f1')
  const [ruleMatch, setRuleMatch] = useState<'all' | 'any'>(initialValues?.rules?.match ?? 'all')
  const [conditions, setConditions] = useState<RuleCondition[]>(
    (initialValues?.rules?.conditions as RuleCondition[]) ?? []
  )

  // Reset when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '')
      setDescription(initialValues?.description ?? '')
      setType(initialValues?.type ?? 'manual')
      setColor(initialValues?.color ?? '#6366f1')
      setRuleMatch(initialValues?.rules?.match ?? 'all')
      setConditions((initialValues?.rules?.conditions as RuleCondition[]) ?? [])
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      name: name.trim(),
      description: description.trim(),
      type,
      color,
      rules: {
        match: ruleMatch,
        conditions,
      },
    })
  }

  const canSubmit = name.trim().length > 0 && (type === 'manual' || conditions.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Segment' : 'Create Segment'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type selector - only when creating */}
          {!isEditing && (
            <div className="flex gap-3">
              {(['manual', 'dynamic'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'flex-1 px-4 py-3 rounded-lg border-2 text-left transition-colors',
                    type === t
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-border/80'
                  )}
                >
                  <div className="font-medium text-sm capitalize">{t}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t === 'manual'
                      ? 'Manually assign users to this segment'
                      : 'Auto-populate based on rules'}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="seg-name">Name</Label>
            <Input
              id="seg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enterprise customers"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="seg-desc">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="seg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Users on an enterprise plan"
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-6 w-6 rounded-full transition-all ring-offset-2',
                    color === c ? 'ring-2 ring-ring' : 'hover:scale-110'
                  )}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Rules (dynamic only) */}
          {type === 'dynamic' && (
            <div className="space-y-2 border border-border/50 rounded-lg p-4 bg-muted/20">
              <Label className="text-sm font-medium">Rules</Label>
              <p className="text-xs text-muted-foreground">
                Define conditions to automatically match users. Membership is refreshed when you
                trigger evaluation.
              </p>
              <RuleBuilder
                match={ruleMatch}
                conditions={conditions}
                onMatchChange={setRuleMatch}
                onConditionsChange={setConditions}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? 'Saving...' : isEditing ? 'Save changes' : 'Create segment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
  | 'is_set'
  | 'is_not_set'

export interface RuleCondition {
  attribute: string
  operator: RuleOperator
  value: string
  metadataKey?: string
}

export interface CustomAttrDef {
  id: string
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
  currencyCode?: string | null
  description?: string | null
}

const BUILT_IN_ATTRIBUTE_OPTIONS: { value: RuleAttribute; label: string }[] = [
  { value: 'email_domain', label: 'Email Domain' },
  { value: 'email_verified', label: 'Email Verified' },
  { value: 'created_at_days_ago', label: 'Days Since Joined' },
  { value: 'post_count', label: 'Post Count' },
  { value: 'vote_count', label: 'Vote Count' },
  { value: 'comment_count', label: 'Comment Count' },
  { value: 'plan', label: 'Plan (metadata)' },
  { value: 'metadata_key', label: 'Custom Metadata Key' },
]

const CUSTOM_ATTR_OPERATORS: Record<
  'string' | 'number' | 'boolean' | 'date' | 'currency',
  { value: RuleOperator; label: string }[]
> = {
  string: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
  number: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
  boolean: [
    { value: 'eq', label: 'is' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
  date: [
    { value: 'gt', label: 'before (days ago)' },
    { value: 'lt', label: 'after (days ago)' },
    { value: 'gte', label: 'at least (days ago)' },
    { value: 'lte', label: 'at most (days ago)' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
  currency: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
}

const OPERATOR_OPTIONS: Record<RuleAttribute, { value: RuleOperator; label: string }[]> = {
  email_domain: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
  email_verified: [
    { value: 'eq', label: 'is' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
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
    { value: 'is_set', label: 'has any' },
    { value: 'is_not_set', label: 'has none' },
  ],
  vote_count: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
    { value: 'is_set', label: 'has any' },
    { value: 'is_not_set', label: 'has none' },
  ],
  comment_count: [
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'equals' },
    { value: 'is_set', label: 'has any' },
    { value: 'is_not_set', label: 'has none' },
  ],
  plan: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
  metadata_key: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' },
  ],
}

// ============================================
// Rule condition row
// ============================================

function RuleConditionRow({
  condition,
  onChange,
  onRemove,
  customAttributes,
}: {
  condition: RuleCondition
  onChange: (updated: RuleCondition) => void
  onRemove: () => void
  customAttributes?: CustomAttrDef[]
}) {
  const isCustomAttr = condition.attribute.startsWith('__custom__')
  const customAttrKey = isCustomAttr ? condition.attribute.slice(10) : null
  const customAttrDef = customAttrKey
    ? (customAttributes?.find((a) => a.key === customAttrKey) ?? null)
    : null

  const operators = isCustomAttr
    ? customAttrDef
      ? CUSTOM_ATTR_OPERATORS[customAttrDef.type]
      : CUSTOM_ATTR_OPERATORS.string
    : (OPERATOR_OPTIONS[condition.attribute as RuleAttribute] ?? [])

  const isNumericBuiltIn = [
    'created_at_days_ago',
    'post_count',
    'vote_count',
    'comment_count',
  ].includes(condition.attribute)
  const isCustomNumeric = customAttrDef?.type === 'number' || customAttrDef?.type === 'currency'
  const isCustomDate = customAttrDef?.type === 'date'
  const isNumeric = isNumericBuiltIn || isCustomNumeric || isCustomDate

  const isBooleanBuiltIn = condition.attribute === 'email_verified'
  const isCustomBoolean = customAttrDef?.type === 'boolean'
  const isBoolean = isBooleanBuiltIn || isCustomBoolean

  const isPresenceOp = condition.operator === 'is_set' || condition.operator === 'is_not_set'

  const getFirstOperator = (attr: string) => {
    if (attr.startsWith('__custom__')) {
      const key = attr.slice(10)
      const def = customAttributes?.find((a) => a.key === key)
      return (def ? CUSTOM_ATTR_OPERATORS[def.type][0]?.value : 'eq') as RuleOperator
    }
    return (OPERATOR_OPTIONS[attr as RuleAttribute]?.[0]?.value ?? 'eq') as RuleOperator
  }

  return (
    <div className="flex items-start gap-2">
      {/* Attribute */}
      <Select
        value={condition.attribute}
        onValueChange={(val) =>
          onChange({
            ...condition,
            attribute: val,
            operator: getFirstOperator(val),
            value: '',
            metadataKey: val.startsWith('__custom__') ? val.slice(10) : undefined,
          })
        }
      >
        <SelectTrigger className="h-8 text-xs w-[160px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {BUILT_IN_ATTRIBUTE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectGroup>
          {customAttributes && customAttributes.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider px-2 py-1.5">
                  Custom attributes
                </SelectLabel>
                {customAttributes.map((attr) => (
                  <SelectItem
                    key={`__custom__${attr.key}`}
                    value={`__custom__${attr.key}`}
                    className="text-xs"
                  >
                    {attr.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
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

      {/* Metadata key (only for raw metadata_key attribute — custom attrs have key auto-set) */}
      {condition.attribute === 'metadata_key' && !isCustomAttr && (
        <Input
          className="h-8 text-xs w-[100px] shrink-0"
          placeholder="key"
          value={condition.metadataKey ?? ''}
          onChange={(e) => onChange({ ...condition, metadataKey: e.target.value })}
        />
      )}

      {/* Value — hidden for is_set / is_not_set operators */}
      {!isPresenceOp && (
        <>
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
        </>
      )}
      {isPresenceOp && <div className="flex-1" />}

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
  customAttributes,
}: {
  match: 'all' | 'any'
  conditions: RuleCondition[]
  onMatchChange: (v: 'all' | 'any') => void
  onConditionsChange: (v: RuleCondition[]) => void
  customAttributes?: CustomAttrDef[]
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
            customAttributes={customAttributes}
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
// Schedule presets
// ============================================

const SCHEDULE_PRESETS: { label: string; value: string }[] = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily (midnight)', value: '0 0 * * *' },
  { label: 'Daily (6 AM)', value: '0 6 * * *' },
  { label: 'Weekly (Monday)', value: '0 0 * * 1' },
]

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL']

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
  evaluationSchedule: {
    enabled: boolean
    pattern: string
  }
  weightConfig: {
    enabled: boolean
    attributeKey: string
    attributeLabel: string
    attributeType: 'string' | 'number' | 'boolean' | 'date' | 'currency'
    currencyCode: string
    aggregation: 'sum' | 'average' | 'count' | 'median'
  }
}

interface SegmentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: Partial<SegmentFormValues> & { id?: SegmentId }
  onSubmit: (values: SegmentFormValues) => Promise<void>
  isPending?: boolean
  customAttributes?: CustomAttrDef[]
}

export function SegmentFormDialog({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  isPending,
  customAttributes,
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

  // Evaluation schedule state
  const [scheduleEnabled, setScheduleEnabled] = useState(
    initialValues?.evaluationSchedule?.enabled ?? false
  )
  const [schedulePattern, setSchedulePattern] = useState(
    initialValues?.evaluationSchedule?.pattern ?? '0 0 * * *'
  )

  // Weight config state
  const [weightEnabled, setWeightEnabled] = useState(initialValues?.weightConfig?.enabled ?? false)
  const [weightAttrKey, setWeightAttrKey] = useState(
    initialValues?.weightConfig?.attributeKey ?? 'mrr'
  )
  const [weightAttrLabel, setWeightAttrLabel] = useState(
    initialValues?.weightConfig?.attributeLabel ?? 'MRR'
  )
  const [weightAttrType, setWeightAttrType] = useState<
    'string' | 'number' | 'boolean' | 'date' | 'currency'
  >(initialValues?.weightConfig?.attributeType ?? 'currency')
  const [weightCurrencyCode, setWeightCurrencyCode] = useState(
    initialValues?.weightConfig?.currencyCode ?? 'USD'
  )
  const [weightAggregation, setWeightAggregation] = useState<
    'sum' | 'average' | 'count' | 'median'
  >(initialValues?.weightConfig?.aggregation ?? 'sum')

  // Reset when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '')
      setDescription(initialValues?.description ?? '')
      setType(initialValues?.type ?? 'manual')
      setColor(initialValues?.color ?? '#6366f1')
      setRuleMatch(initialValues?.rules?.match ?? 'all')
      setConditions((initialValues?.rules?.conditions as RuleCondition[]) ?? [])
      setScheduleEnabled(initialValues?.evaluationSchedule?.enabled ?? false)
      setSchedulePattern(initialValues?.evaluationSchedule?.pattern ?? '0 0 * * *')
      setWeightEnabled(initialValues?.weightConfig?.enabled ?? false)
      setWeightAttrKey(initialValues?.weightConfig?.attributeKey ?? 'mrr')
      setWeightAttrLabel(initialValues?.weightConfig?.attributeLabel ?? 'MRR')
      setWeightAttrType(initialValues?.weightConfig?.attributeType ?? 'currency')
      setWeightCurrencyCode(initialValues?.weightConfig?.currencyCode ?? 'USD')
      setWeightAggregation(initialValues?.weightConfig?.aggregation ?? 'sum')
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
      evaluationSchedule: {
        enabled: scheduleEnabled,
        pattern: schedulePattern,
      },
      weightConfig: {
        enabled: weightEnabled,
        attributeKey: weightAttrKey,
        attributeLabel: weightAttrLabel,
        attributeType: weightAttrType,
        currencyCode: weightCurrencyCode,
        aggregation: weightAggregation,
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
                customAttributes={customAttributes}
              />
            </div>
          )}

          {/* Auto-evaluation schedule (dynamic only) */}
          {type === 'dynamic' && (
            <div className="space-y-3 border border-border/50 rounded-lg p-4 bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Auto-evaluate</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically re-evaluate membership on a schedule
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={scheduleEnabled}
                  onClick={() => setScheduleEnabled(!scheduleEnabled)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    scheduleEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                      scheduleEnabled ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
              {scheduleEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="schedule-pattern" className="text-xs">
                    Schedule
                  </Label>
                  <Select value={schedulePattern} onValueChange={setSchedulePattern}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value} className="text-xs">
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Cron: <code className="bg-muted px-1 py-0.5 rounded">{schedulePattern}</code>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Weight config */}
          <div className="space-y-3 border border-border/50 rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Weight by attribute</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Weight this segment's feedback by a user attribute (e.g. MRR)
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={weightEnabled}
                onClick={() => setWeightEnabled(!weightEnabled)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  weightEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                    weightEnabled ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
            {weightEnabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Metadata key</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="mrr"
                      value={weightAttrKey}
                      onChange={(e) => setWeightAttrKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Display label</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="MRR"
                      value={weightAttrLabel}
                      onChange={(e) => setWeightAttrLabel(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Attribute type</Label>
                    <Select
                      value={weightAttrType}
                      onValueChange={(v) => setWeightAttrType(v as typeof weightAttrType)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="number" className="text-xs">
                          Number
                        </SelectItem>
                        <SelectItem value="currency" className="text-xs">
                          Currency
                        </SelectItem>
                        <SelectItem value="string" className="text-xs">
                          String
                        </SelectItem>
                        <SelectItem value="boolean" className="text-xs">
                          Boolean
                        </SelectItem>
                        <SelectItem value="date" className="text-xs">
                          Date
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Aggregation</Label>
                    <Select
                      value={weightAggregation}
                      onValueChange={(v) => setWeightAggregation(v as typeof weightAggregation)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sum" className="text-xs">
                          Sum
                        </SelectItem>
                        <SelectItem value="average" className="text-xs">
                          Average
                        </SelectItem>
                        <SelectItem value="count" className="text-xs">
                          Count
                        </SelectItem>
                        <SelectItem value="median" className="text-xs">
                          Median
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {weightAttrType === 'currency' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Currency</Label>
                    <Select value={weightCurrencyCode} onValueChange={setWeightCurrencyCode}>
                      <SelectTrigger className="h-8 text-xs w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map((code) => (
                          <SelectItem key={code} value={code} className="text-xs">
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>

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

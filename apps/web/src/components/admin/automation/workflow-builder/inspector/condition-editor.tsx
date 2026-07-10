/**
 * One level of "all/any of these rules" condition editing, ported unchanged
 * from the old popover editor. Nested groups (or a value that doesn't fit
 * the field's kind) are preserved as-is and stay editable only via JSON mode.
 *
 * Extended (support platform §4.6 / AI attributes parity Phase 0) with a
 * "Conversation attribute" field group backed by the live attribute registry
 * (WorkflowEntitiesProvider): field label, operator set, and value input all
 * come from the matching definition's field type, reusing AttributeValueInput
 * so this editor and the set_attribute action editor stay in the same voice.
 * A stored `conversation.attr.<key>` with no live definition (archived, or
 * authored before/after the current registry) degrades to a labeled-unknown
 * row with a raw text value instead of blocking — mirrors action-editor's
 * unknown-key fallback for set_attribute.
 */
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AttributeValueInput,
  type AttributeInputValue,
} from '@/components/admin/conversation/attribute-value-input'
import type { ConversationAttributeItem } from '@/lib/client/queries/conversation-attributes'
import { useWorkflowEntities } from '../entities'
import {
  CONDITION_FIELD_LIST,
  CONDITION_FIELD_META,
  OPERATORS_BY_KIND,
  VALUELESS_OPERATORS,
  attributeFieldForKey,
  attributeKeyFromField,
  conditionToDraft,
  defaultRule,
  draftToCondition,
  isAttributeField,
  resolveConditionField,
  OPERATOR_LABELS,
  type AttributeFieldDef,
  type ConditionField,
  type ConditionOperator,
  type ConditionRuleDraft,
  type GraphCondition,
} from '../../workflow-graph'

export function ConditionEditor({
  subject,
  condition,
  onChange,
}: {
  subject: string
  condition: GraphCondition
  onChange: (condition: GraphCondition) => void
}) {
  const { attributes, labels } = useWorkflowEntities()
  const attributeFieldDefs = labels.attributes ?? new Map<string, AttributeFieldDef>()
  const teams = labels.teams ?? new Map<string, string>()
  const draft = conditionToDraft(condition)

  if (draft.kind === 'advanced') {
    return (
      <p className="text-xs text-muted-foreground">
        This condition nests groups the visual editor can&apos;t show. Use JSON mode to change it.
      </p>
    )
  }

  const commit = (next: typeof draft) => onChange(draftToCondition(next, attributeFieldDefs))
  const updateRule = (index: number, rule: ConditionRuleDraft) =>
    commit({ ...draft, rules: draft.rules.map((r, i) => (i === index ? rule : r)) })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{subject}</span>
        {draft.rules.length > 1 && (
          <>
            <Select
              value={draft.mode}
              onValueChange={(mode) => commit({ ...draft, mode: mode as 'all' | 'any' })}
            >
              <SelectTrigger size="xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="any">any</SelectItem>
              </SelectContent>
            </Select>
            <span>of these match</span>
          </>
        )}
      </div>

      {draft.rules.map((rule, i) => (
        <RuleRow
          key={i}
          rule={rule}
          attributeFieldDefs={attributeFieldDefs}
          attributeItems={attributes}
          teams={teams}
          onChange={(r) => updateRule(i, r)}
          onRemove={() => commit({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}
        />
      ))}

      {draft.rules.length === 0 && (
        <p className="text-xs text-muted-foreground">No rules yet, so everything matches.</p>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => commit({ ...draft, rules: [...draft.rules, defaultRule()] })}
      >
        <PlusIcon className="size-3.5" /> Add rule
      </Button>
    </div>
  )
}

function RuleRow({
  rule,
  attributeFieldDefs,
  attributeItems,
  teams,
  onChange,
  onRemove,
}: {
  rule: ConditionRuleDraft
  attributeFieldDefs: ReadonlyMap<string, AttributeFieldDef>
  attributeItems: ConversationAttributeItem[]
  teams: ReadonlyMap<string, string>
  onChange: (rule: ConditionRuleDraft) => void
  onRemove: () => void
}) {
  const meta = resolveConditionField(rule.field, attributeFieldDefs, teams)
  const operators = meta.operators
  const needsValue = !VALUELESS_OPERATORS.has(rule.op)
  const unknownAttributeKey = isAttributeField(rule.field) && meta.unresolved

  const setField = (field: ConditionField) => {
    if (isAttributeField(field)) {
      const def = attributeFieldDefs.get(attributeKeyFromField(field))
      const op = resolveConditionField(field, attributeFieldDefs).operators[0]!
      const value =
        def?.fieldType === 'select'
          ? (def.options?.[0]?.id ?? '')
          : def?.fieldType === 'checkbox'
            ? 'true'
            : ''
      onChange({ field, op, value })
      return
    }
    // resolveConditionField (not the raw static meta) so conversation.team's
    // live-loaded options pick a real default instead of always landing on ''.
    const fieldMeta = resolveConditionField(field, attributeFieldDefs, teams)
    const op = OPERATORS_BY_KIND[fieldMeta.kind][0]!
    const value =
      fieldMeta.kind === 'choice'
        ? (fieldMeta.options?.[0]?.value ?? '')
        : fieldMeta.kind === 'boolean'
          ? 'true'
          : ''
    onChange({ field, op, value })
  }

  const setOp = (op: ConditionOperator) =>
    onChange({ ...rule, op, value: VALUELESS_OPERATORS.has(op) ? '' : rule.value })

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-1.5">
        <Select value={rule.field} onValueChange={(f) => setField(f as ConditionField)}>
          <SelectTrigger size="xs" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {CONDITION_FIELD_LIST.map((f) => (
                <SelectItem key={f} value={f}>
                  {CONDITION_FIELD_META[f].label}
                </SelectItem>
              ))}
            </SelectGroup>
            {attributeItems.length > 0 && (
              <SelectGroup>
                <SelectLabel>Conversation attribute</SelectLabel>
                {attributeItems.map((d) => (
                  <SelectItem key={d.key} value={attributeFieldForKey(d.key)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {/* A stored graph can reference an attribute key with no live
                definition (archived, or authored before/after the current
                registry): inject a selectable item so the trigger still
                displays it, instead of rendering blank. */}
            {unknownAttributeKey && <SelectItem value={rule.field}>{meta.label}</SelectItem>}
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-label="Remove rule"
          onClick={onRemove}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <XMarkIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <Select value={rule.op} onValueChange={(op) => setOp(op as ConditionOperator)}>
          <SelectTrigger
            size="xs"
            className={cn('min-w-0', needsValue ? 'w-32 shrink-0' : 'flex-1')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needsValue && (
          <RuleValueEditor
            rule={rule}
            attributeItems={attributeItems}
            teams={teams}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  )
}

function RuleValueEditor({
  rule,
  attributeItems,
  teams,
  onChange,
}: {
  rule: ConditionRuleDraft
  attributeItems: ConversationAttributeItem[]
  teams: ReadonlyMap<string, string>
  onChange: (rule: ConditionRuleDraft) => void
}) {
  if (isAttributeField(rule.field)) {
    return (
      <AttributeRuleValueEditor rule={rule} attributeItems={attributeItems} onChange={onChange} />
    )
  }

  const meta = resolveConditionField(rule.field, undefined, teams)
  const set = (value: string) => onChange({ ...rule, value })

  if (meta.kind === 'choice') {
    return (
      <Select value={rule.value} onValueChange={set}>
        <SelectTrigger size="xs" className="min-w-0 flex-1">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {(meta.options ?? []).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (meta.kind === 'boolean') {
    return (
      <Select value={rule.value || 'true'} onValueChange={set}>
        <SelectTrigger size="xs" className="min-w-0 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      type={meta.kind === 'number' ? 'number' : 'text'}
      value={rule.value}
      onChange={(e) => set(e.target.value)}
      placeholder={meta.placeholder}
      className="h-6 min-w-0 flex-1 px-1.5 text-xs"
    />
  )
}

/** Encode/decode between the rule draft's string encoding (comma-joined for
 *  multi-value, 'true'/'false' for checkbox) and AttributeValueInput's typed
 *  JSON value — the same shapes ruleToLeaf/leafToRule use for the stored
 *  condition, so a value round-trips identically through either editor. */
function decodeAttributeRuleValue(
  fieldType: ConversationAttributeItem['fieldType'],
  raw: string
): unknown {
  if (fieldType === 'multi_select') {
    return raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  }
  if (fieldType === 'checkbox') return raw === 'true'
  if (fieldType === 'number') return raw === '' ? null : Number(raw)
  return raw === '' ? null : raw
}

function encodeAttributeRuleValue(value: AttributeInputValue): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function AttributeRuleValueEditor({
  rule,
  attributeItems,
  onChange,
}: {
  rule: ConditionRuleDraft
  attributeItems: ConversationAttributeItem[]
  onChange: (rule: ConditionRuleDraft) => void
}) {
  // Only ever rendered when RuleValueEditor has already confirmed this, but
  // guard again here so the narrowing (and attributeKeyFromField's type) is
  // sound without a cast.
  if (!isAttributeField(rule.field)) return null
  const key = attributeKeyFromField(rule.field)
  const def = attributeItems.find((d) => d.key === key)

  if (!def) {
    // No live definition (archived / unknown key): keep the raw text input so
    // the rule stays editable, same fallback action-editor uses for an
    // unknown set_attribute key.
    return (
      <Input
        value={rule.value}
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
        placeholder="Value"
        className="h-6 min-w-0 flex-1 px-1.5 text-xs"
      />
    )
  }

  return (
    <AttributeValueInput
      definition={def}
      value={decodeAttributeRuleValue(def.fieldType, rule.value)}
      onChange={(value) => onChange({ ...rule, value: encodeAttributeRuleValue(value) })}
      className="h-6 flex-1 text-xs"
    />
  )
}

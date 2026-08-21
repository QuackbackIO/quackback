/**
 * RuleGroupBuilder: the shared rule-group editor behind the condition step
 * (condition-editor.tsx), branch paths (branch-editor.tsx, via
 * condition-editor.tsx), and the trigger's Audience section
 * (trigger-editor.tsx) — support platform §4.6 audience targeting / shared
 * rule-group builder.
 *
 * Renders the flat "all/any of these rules" shape unchanged from the old
 * popover editor (rows of property·operator·value; the mode selector only
 * appears once there's more than one rule) PLUS, one level up, multiple such
 * groups combined with OR ("Add group"): the stored `any: [ {all:[...]},
 * {any:[...]}, ... ]` shape a 2-level condition needs (see
 * workflow-graph.ts's conditionToGroupDraft/groupsToCondition for the exact
 * decode/encode rules). A single group round-trips through the SAME flat
 * shape the one-level editor always wrote — RuleGroupBuilder only ADDS the
 * OR-of-groups capability, it never changes what a plain single-group
 * condition looks like on disk.
 *
 * Depth-capped at exactly those two levels: a stored condition nesting
 * further (a group inside a group, an AND of groups, ...) degrades to a
 * read-only notice, same "stays editable only via JSON mode" contract the
 * old editor already had for any condition it couldn't show — nothing is
 * ever silently dropped.
 *
 * The property picker is organized by entity group (Conversation / Message /
 * Person / Availability from the static catalogue, plus the live
 * Conversation attribute / Person attribute / Company attribute registries)
 * via workflow-graph.ts's STATIC_CONDITION_FIELD_GROUPS.
 */
import { PlusIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline'
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
  CONDITION_FIELD_META,
  OPERATORS_BY_KIND,
  STATIC_CONDITION_FIELD_GROUPS,
  VALUELESS_OPERATORS,
  attributeFieldForKey,
  attributeKeyFromField,
  personAttributeFieldForKey,
  personAttributeKeyFromField,
  companyAttributeFieldForKey,
  companyAttributeKeyFromField,
  conditionToGroupDraft,
  groupsToCondition,
  defaultRule,
  defaultRuleGroup,
  isAttributeField,
  isPersonAttributeField,
  isCompanyAttributeField,
  resolveConditionField,
  OPERATOR_LABELS,
  type AttributeFieldDef,
  type PersonCompanyAttributeFieldDef,
  type PersonCompanyAttributeType,
  type ConditionField,
  type ConditionOperator,
  type ConditionRuleDraft,
  type RuleGroupDraft,
  type GraphCondition,
} from '../../workflow-graph'

const DEFAULT_ADVANCED_FALLBACK =
  "This condition nests groups the visual editor can't show. Use JSON mode to change it."

function AiFieldBadge() {
  return (
    <span
      aria-label="AI"
      className="inline-flex items-center gap-0.5 rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400"
    >
      <SparklesIcon className="size-2.5" aria-hidden />
      AI
    </span>
  )
}

export function RuleGroupBuilder({
  subject,
  condition,
  onChange,
  advancedFallback,
}: {
  subject: string
  condition: GraphCondition
  onChange: (condition: GraphCondition) => void
  /** Message shown in place of the editor for a condition too deep to
   *  render (see the module doc). Callers with no JSON-mode escape hatch
   *  of their own (the trigger's Audience section) pass their own wording. */
  advancedFallback?: string
}) {
  const { attributes, personAttributes, companyAttributes, labels } = useWorkflowEntities()
  const attributeFieldDefs = labels.attributes ?? new Map<string, AttributeFieldDef>()
  const personAttributeFieldDefs =
    labels.personAttributes ?? new Map<string, PersonCompanyAttributeFieldDef>()
  const companyAttributeFieldDefs =
    labels.companyAttributes ?? new Map<string, PersonCompanyAttributeFieldDef>()
  const teams = labels.teams ?? new Map<string, string>()
  const ticketTypes = labels.ticketTypes ?? new Map<string, string>()
  const draft = conditionToGroupDraft(condition)

  if (draft.kind === 'advanced') {
    return (
      <p className="text-xs text-muted-foreground">
        {advancedFallback ?? DEFAULT_ADVANCED_FALLBACK}
      </p>
    )
  }

  const commitGroups = (groups: RuleGroupDraft[]) =>
    onChange(
      groupsToCondition(
        groups,
        attributeFieldDefs,
        personAttributeFieldDefs,
        companyAttributeFieldDefs
      )
    )
  const updateGroup = (index: number, group: RuleGroupDraft) =>
    commitGroups(draft.groups.map((g, i) => (i === index ? group : g)))
  const removeGroup = (index: number) => {
    if (draft.groups.length <= 1) return
    commitGroups(draft.groups.filter((_, i) => i !== index))
  }
  const addGroup = () => commitGroups([...draft.groups, defaultRuleGroup()])

  return (
    <div className="space-y-2">
      {draft.groups.map((group, i) => (
        <div key={i}>
          {i > 0 && (
            <div className="flex items-center gap-1.5 py-1 text-[11px] font-medium text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              OR
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <RuleGroup
            subject={subject}
            group={group}
            attributeFieldDefs={attributeFieldDefs}
            personAttributeFieldDefs={personAttributeFieldDefs}
            companyAttributeFieldDefs={companyAttributeFieldDefs}
            attributeItems={attributes}
            personAttributeItems={personAttributes}
            companyAttributeItems={companyAttributes}
            teams={teams}
            ticketTypes={ticketTypes}
            removable={draft.groups.length > 1}
            onChange={(g) => updateGroup(i, g)}
            onRemoveGroup={() => removeGroup(i)}
          />
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={addGroup}
      >
        <PlusIcon className="size-3.5" /> Add group (OR)
      </Button>
    </div>
  )
}

function RuleGroup({
  subject,
  group,
  attributeFieldDefs,
  personAttributeFieldDefs,
  companyAttributeFieldDefs,
  attributeItems,
  personAttributeItems,
  companyAttributeItems,
  teams,
  ticketTypes,
  removable,
  onChange,
  onRemoveGroup,
}: {
  subject: string
  group: RuleGroupDraft
  attributeFieldDefs: ReadonlyMap<string, AttributeFieldDef>
  personAttributeFieldDefs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  companyAttributeFieldDefs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  attributeItems: ConversationAttributeItem[]
  personAttributeItems: PersonCompanyAttributeFieldDef[]
  companyAttributeItems: PersonCompanyAttributeFieldDef[]
  teams: ReadonlyMap<string, string>
  ticketTypes: ReadonlyMap<string, string>
  removable: boolean
  onChange: (group: RuleGroupDraft) => void
  onRemoveGroup: () => void
}) {
  const updateRule = (index: number, rule: ConditionRuleDraft) =>
    onChange({ ...group, rules: group.rules.map((r, i) => (i === index ? rule : r)) })

  return (
    <div className={cn('space-y-2', removable && 'rounded-md border p-2')}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{subject}</span>
        {group.rules.length > 1 && (
          <>
            <Select
              value={group.mode}
              onValueChange={(mode) => onChange({ ...group, mode: mode as 'all' | 'any' })}
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
        {removable && (
          <button
            type="button"
            aria-label="Remove group"
            onClick={onRemoveGroup}
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        )}
      </div>

      {group.rules.map((rule, i) => (
        <RuleRow
          key={i}
          rule={rule}
          attributeFieldDefs={attributeFieldDefs}
          personAttributeFieldDefs={personAttributeFieldDefs}
          companyAttributeFieldDefs={companyAttributeFieldDefs}
          attributeItems={attributeItems}
          personAttributeItems={personAttributeItems}
          companyAttributeItems={companyAttributeItems}
          teams={teams}
          ticketTypes={ticketTypes}
          onChange={(r) => updateRule(i, r)}
          onRemove={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })}
        />
      ))}

      {group.rules.length === 0 &&
        (removable ? (
          // One of several OR'd groups: an emptied group is dropped on save
          // (workflow-graph.ts's groupsToCondition), not treated as "matches
          // everything" — that would silently override the other groups.
          <p className="text-xs text-muted-foreground">
            No rules in this group — it's ignored until you add one.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No rules yet, so everything matches.</p>
        ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onChange({ ...group, rules: [...group.rules, defaultRule()] })}
      >
        <PlusIcon className="size-3.5" /> Add rule
      </Button>
    </div>
  )
}

function RuleRow({
  rule,
  attributeFieldDefs,
  personAttributeFieldDefs,
  companyAttributeFieldDefs,
  attributeItems,
  personAttributeItems,
  companyAttributeItems,
  teams,
  ticketTypes,
  onChange,
  onRemove,
}: {
  rule: ConditionRuleDraft
  attributeFieldDefs: ReadonlyMap<string, AttributeFieldDef>
  personAttributeFieldDefs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  companyAttributeFieldDefs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  attributeItems: ConversationAttributeItem[]
  personAttributeItems: PersonCompanyAttributeFieldDef[]
  companyAttributeItems: PersonCompanyAttributeFieldDef[]
  teams: ReadonlyMap<string, string>
  ticketTypes: ReadonlyMap<string, string>
  onChange: (rule: ConditionRuleDraft) => void
  onRemove: () => void
}) {
  const meta = resolveConditionField(
    rule.field,
    attributeFieldDefs,
    teams,
    personAttributeFieldDefs,
    companyAttributeFieldDefs,
    ticketTypes
  )
  const operators = meta.operators
  const needsValue = !VALUELESS_OPERATORS.has(rule.op)
  const isDynamicAttributeField =
    isAttributeField(rule.field) ||
    isPersonAttributeField(rule.field) ||
    isCompanyAttributeField(rule.field)
  const unknownAttributeKey = isDynamicAttributeField && meta.unresolved
  const selectedAiAttribute = isAttributeField(rule.field)
    ? attributeItems.find((d) => attributeFieldForKey(d.key) === rule.field)
    : undefined
  const showAiHint = Boolean(selectedAiAttribute?.aiDetect)

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
    if (isPersonAttributeField(field) || isCompanyAttributeField(field)) {
      const key = isPersonAttributeField(field)
        ? personAttributeKeyFromField(field)
        : companyAttributeKeyFromField(field)
      const def = (
        isPersonAttributeField(field) ? personAttributeFieldDefs : companyAttributeFieldDefs
      ).get(key)
      const op = resolveConditionField(
        field,
        undefined,
        undefined,
        personAttributeFieldDefs,
        companyAttributeFieldDefs
      ).operators[0]!
      const value = def?.type === 'boolean' ? 'true' : ''
      onChange({ field, op, value })
      return
    }
    // resolveConditionField (not the raw static meta) so conversation.team's
    // live-loaded options pick a real default instead of always landing on ''.
    const fieldMeta = resolveConditionField(
      field,
      attributeFieldDefs,
      teams,
      undefined,
      undefined,
      ticketTypes
    )
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
            {STATIC_CONDITION_FIELD_GROUPS.map(
              (g) =>
                g.fields.length > 0 && (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.fields.map((f) => (
                      <SelectItem key={f} value={f}>
                        {CONDITION_FIELD_META[f].label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
            )}
            {attributeItems.length > 0 && (
              <SelectGroup>
                <SelectLabel>Conversation attribute</SelectLabel>
                {attributeItems.map((d) => (
                  <SelectItem key={d.key} value={attributeFieldForKey(d.key)}>
                    {d.label}
                    {d.aiDetect ? <AiFieldBadge /> : null}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {personAttributeItems.length > 0 && (
              <SelectGroup>
                <SelectLabel>Person attribute</SelectLabel>
                {personAttributeItems.map((d) => (
                  <SelectItem key={d.key} value={personAttributeFieldForKey(d.key)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {companyAttributeItems.length > 0 && (
              <SelectGroup>
                <SelectLabel>Company attribute</SelectLabel>
                {companyAttributeItems.map((d) => (
                  <SelectItem key={d.key} value={companyAttributeFieldForKey(d.key)}>
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
      {showAiHint && (
        <p className="text-[11px] text-muted-foreground">
          Classified by Quinn when conversations settle. Requires Inbox AI.
        </p>
      )}
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
            personAttributeFieldDefs={personAttributeFieldDefs}
            companyAttributeFieldDefs={companyAttributeFieldDefs}
            teams={teams}
            ticketTypes={ticketTypes}
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
  personAttributeFieldDefs,
  companyAttributeFieldDefs,
  teams,
  ticketTypes,
  onChange,
}: {
  rule: ConditionRuleDraft
  attributeItems: ConversationAttributeItem[]
  personAttributeFieldDefs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  companyAttributeFieldDefs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  teams: ReadonlyMap<string, string>
  ticketTypes: ReadonlyMap<string, string>
  onChange: (rule: ConditionRuleDraft) => void
}) {
  if (isAttributeField(rule.field)) {
    return (
      <AttributeRuleValueEditor rule={rule} attributeItems={attributeItems} onChange={onChange} />
    )
  }
  if (isPersonAttributeField(rule.field) || isCompanyAttributeField(rule.field)) {
    const defs = isPersonAttributeField(rule.field)
      ? personAttributeFieldDefs
      : companyAttributeFieldDefs
    return <PersonCompanyAttributeRuleValueEditor rule={rule} defs={defs} onChange={onChange} />
  }

  const meta = resolveConditionField(
    rule.field,
    undefined,
    teams,
    undefined,
    undefined,
    ticketTypes
  )
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

/** person.attr / company.attr have no select/multi_select in their registry
 *  (UserAttributeType/CompanyAttributeType: string|number|boolean|date|
 *  currency), so AttributeValueInput is reused via a synthesized fieldType
 *  rather than the live definition's own — `options` is always undefined. */
const PERSON_COMPANY_TYPE_TO_FIELD_TYPE: Record<
  PersonCompanyAttributeType,
  ConversationAttributeItem['fieldType']
> = {
  string: 'text',
  number: 'number',
  boolean: 'checkbox',
  date: 'date',
  currency: 'number',
}

function decodePersonCompanyRuleValue(type: PersonCompanyAttributeType, raw: string): unknown {
  if (type === 'boolean') return raw === 'true'
  if (type === 'number' || type === 'currency') return raw === '' ? null : Number(raw)
  return raw === '' ? null : raw
}

function PersonCompanyAttributeRuleValueEditor({
  rule,
  defs,
  onChange,
}: {
  rule: ConditionRuleDraft
  defs: ReadonlyMap<string, PersonCompanyAttributeFieldDef>
  onChange: (rule: ConditionRuleDraft) => void
}) {
  if (!(isPersonAttributeField(rule.field) || isCompanyAttributeField(rule.field))) return null
  const key = isPersonAttributeField(rule.field)
    ? personAttributeKeyFromField(rule.field)
    : companyAttributeKeyFromField(rule.field)
  const def = defs.get(key)

  if (!def) {
    // No live definition (archived / unknown key): keep the raw text input,
    // same fallback AttributeRuleValueEditor uses for an unknown
    // conversation.attr key.
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
      definition={{ fieldType: PERSON_COMPANY_TYPE_TO_FIELD_TYPE[def.type], options: null }}
      value={decodePersonCompanyRuleValue(def.type, rule.value)}
      onChange={(value) => onChange({ ...rule, value: encodeAttributeRuleValue(value) })}
      className="h-6 flex-1 text-xs"
    />
  )
}

/**
 * Built-in user-segment field registry.
 *
 * Single source of truth for the set of built-in attributes that the
 * dynamic-segment evaluator understands. Consumed by both the server
 * evaluator and the rule-builder UI — keep this module free of DB
 * imports and server-only imports.
 */

export type FieldOperator =
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

export interface BuiltinField {
  /** The SegmentCondition.attribute value stored in the rules JSON */
  key: string
  /** Human label for the picker and attributes view */
  label: string
  /** Data type — drives operator choices and input control rendering */
  type: 'string' | 'number' | 'boolean' | 'date'
  /** Short description shown as a tooltip or helper text */
  description?: string
  /** Enum fields: list of accepted values rendered as a select input */
  allowedValues?: readonly string[]
  /**
   * Explicit operator list for this field, overriding the type-based default.
   * Must match exactly what buildConditionSql handles — the UI only shows
   * operators the evaluator will act on.
   */
  operators?: readonly { value: FieldOperator; label: string }[]
}

/** Default operator sets by type — used when a field does not declare its own */
export const DEFAULT_OPERATORS: Record<
  'string' | 'number' | 'boolean' | 'date',
  readonly { value: FieldOperator; label: string }[]
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
}

/** Returns the operator list for a field, using its override or the type default */
export function getFieldOperators(
  field: BuiltinField
): readonly { value: FieldOperator; label: string }[] {
  return field.operators ?? DEFAULT_OPERATORS[field.type]
}

/**
 * All built-in fields, in display order.
 *
 * - `plan` and `metadata_key` are NOT included — those are the
 *   custom-attribute mechanism and have dedicated handling.
 *
 * `operators` overrides the type default for fields where the evaluator
 * supports a narrower or different set. Derived by reading buildConditionSql.
 */
export const BUILTIN_FIELDS = [
  {
    key: 'name',
    label: 'Name',
    type: 'string',
    description: "The user's display name from their profile.",
    // evaluator: eq/neq/contains/starts_with/ends_with/is_set/is_not_set — matches string default
  },
  {
    key: 'display_name',
    label: 'Display Name',
    type: 'string',
    description:
      "The principal's display name. May differ from the user name for service principals.",
    // evaluator: eq/neq/contains/starts_with/ends_with/is_set/is_not_set — matches string default
  },
  {
    key: 'email_domain',
    label: 'Email Domain',
    type: 'string',
    description: 'The domain part of the email address (e.g. "acme.com").',
    // evaluator only handles eq, neq, ends_with — no contains/starts_with
    operators: [
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'not equals' },
      { value: 'ends_with', label: 'ends with' },
      { value: 'is_set', label: 'is set' },
      { value: 'is_not_set', label: 'is not set' },
    ],
  },
  {
    key: 'email_verified',
    label: 'Email Verified',
    type: 'boolean',
    description: 'Whether the user has verified their email address.',
    // evaluator: eq only (plus is_set/is_not_set) — matches boolean default
  },
  {
    key: 'principal_type',
    label: 'Principal Type',
    type: 'string',
    description: 'Whether the principal is a human user or an anonymous visitor.',
    allowedValues: ['user', 'anonymous'] as const,
    // evaluator: only eq/neq via OPERATOR_SQL; is_set/is_not_set return TRUE/FALSE (trivially useless)
    operators: [
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'not equals' },
    ],
  },
  {
    key: 'created_at_days_ago',
    label: 'Account Age (days)',
    type: 'number',
    description: 'How many days ago the principal was created.',
    // evaluator: all OPERATOR_SQL (gt/gte/lt/lte/eq/neq) — no is_set/is_not_set
    operators: [
      { value: 'gt', label: 'more than (days ago)' },
      { value: 'lt', label: 'less than (days ago)' },
      { value: 'gte', label: 'at least (days ago)' },
      { value: 'lte', label: 'at most (days ago)' },
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'not equals' },
    ],
  },
  {
    key: 'post_count',
    label: 'Post Count',
    type: 'number',
    description: 'Number of feedback posts the user has submitted.',
    // evaluator: OPERATOR_SQL + is_set (> 0) / is_not_set (= 0)
    operators: [
      { value: 'gt', label: 'greater than' },
      { value: 'gte', label: 'at least' },
      { value: 'lt', label: 'less than' },
      { value: 'lte', label: 'at most' },
      { value: 'eq', label: 'equals' },
      { value: 'is_set', label: 'has any' },
      { value: 'is_not_set', label: 'has none' },
    ],
  },
  {
    key: 'vote_count',
    label: 'Vote Count',
    type: 'number',
    description: 'Number of votes the user has cast.',
    operators: [
      { value: 'gt', label: 'greater than' },
      { value: 'gte', label: 'at least' },
      { value: 'lt', label: 'less than' },
      { value: 'lte', label: 'at most' },
      { value: 'eq', label: 'equals' },
      { value: 'is_set', label: 'has any' },
      { value: 'is_not_set', label: 'has none' },
    ],
  },
  {
    key: 'comment_count',
    label: 'Comment Count',
    type: 'number',
    description: 'Number of comments the user has made.',
    operators: [
      { value: 'gt', label: 'greater than' },
      { value: 'gte', label: 'at least' },
      { value: 'lt', label: 'less than' },
      { value: 'lte', label: 'at most' },
      { value: 'eq', label: 'equals' },
      { value: 'is_set', label: 'has any' },
      { value: 'is_not_set', label: 'has none' },
    ],
  },
] as const satisfies readonly BuiltinField[]

/** Map from key to BuiltinField for O(1) lookup */
export const BUILTIN_FIELD_MAP: ReadonlyMap<string, BuiltinField> = new Map(
  BUILTIN_FIELDS.map((f) => [f.key, f])
)

/** Returns true when `key` matches a registered built-in field */
export function isBuiltinField(key: string): boolean {
  return BUILTIN_FIELD_MAP.has(key)
}

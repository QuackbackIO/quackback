/**
 * Conversation attribute VALUE shape, shared by server writers and client
 * editors. Every write stores a `{ v, src, at }` envelope in the
 * conversation/ticket `custom_attributes` jsonb: the value, who set it
 * (write-source provenance), and when. Provenance powers the AI precedence
 * rule: AI never overwrites teammate- or workflow-set values, only its own.
 *
 * Reads must also accept bare legacy values (keys written before the envelope
 * existed, e.g. assistant_escalation_reason): those surface with null
 * provenance.
 */

export const ATTRIBUTE_SOURCES = ['teammate', 'workflow', 'ai', 'customer'] as const

/** Who wrote an attribute value. */
export type ConversationAttributeSource = (typeof ATTRIBUTE_SOURCES)[number]

/** The stored envelope for one attribute value. */
export interface ConversationAttributeEnvelope {
  v: unknown
  src: ConversationAttributeSource
  at: string
}

/** An attribute value as read back: bare legacy values have null provenance. */
export interface ReadAttributeValue {
  v: unknown
  src: ConversationAttributeSource | null
  at: string | null
}

function isEnvelope(raw: unknown): raw is ConversationAttributeEnvelope {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const candidate = raw as Record<string, unknown>
  return (
    'v' in candidate &&
    typeof candidate.src === 'string' &&
    (ATTRIBUTE_SOURCES as readonly string[]).includes(candidate.src)
  )
}

/**
 * Read one stored attribute entry. Returns null when the key is unset;
 * unwraps `{ v, src, at }` envelopes; passes anything else through as a bare
 * legacy value with null provenance (unknown writer — never trusted as AI's
 * own for the precedence rule).
 */
export function readAttributeValue(raw: unknown): ReadAttributeValue | null {
  if (raw === undefined) return null
  if (isEnvelope(raw)) {
    return { v: raw.v, src: raw.src, at: typeof raw.at === 'string' ? raw.at : null }
  }
  return { v: raw, src: null, at: null }
}

/** True when the entry holds a real value (not unset/null/''/[]). */
export function attributeHasValue(raw: unknown): boolean {
  const read = readAttributeValue(raw)
  if (!read) return false
  const { v } = read
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

/** The definition fields the required-to-close check needs. */
export interface RequiredCloseDefinition {
  key: string
  label: string
  requiredToClose: boolean
  archivedAt?: Date | string | null
}

/**
 * The required-to-close attributes a teammate still has to fill before this
 * conversation may be closed. Archived definitions never block a close (they
 * are hidden from editors, so they could never be filled). Enforced only on
 * teammate inbox closes; API/workflow/AI closes bypass by design.
 */
export function missingRequiredAttributes(
  definitions: RequiredCloseDefinition[],
  customAttributes: Record<string, unknown>
): { key: string; label: string }[] {
  return definitions
    .filter(
      (d) => d.requiredToClose && !d.archivedAt && !attributeHasValue(customAttributes[d.key])
    )
    .map((d) => ({ key: d.key, label: d.label }))
}

/** Message prefix the client matches to raise the blocking close prompt. */
export const MISSING_REQUIRED_ATTRIBUTES_PREFIX = 'Missing required attributes'

/** The server-side close guard's error message (labels are shown verbatim). */
export function formatMissingRequiredAttributes(labels: string[]): string {
  return `${MISSING_REQUIRED_ATTRIBUTES_PREFIX}: ${labels.join(', ')}`
}

/** True when a close failed because required attributes are unfilled. */
export function isMissingRequiredAttributesMessage(message: string | null | undefined): boolean {
  return !!message?.includes(MISSING_REQUIRED_ATTRIBUTES_PREFIX)
}

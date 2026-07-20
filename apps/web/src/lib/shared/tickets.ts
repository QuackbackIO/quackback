/**
 * Client-safe ticket helpers (support platform §4.2): the reference formatter,
 * the requester-facing stage labels, the status-category labels, and the
 * per-type custom-form field shape + its validation schema.
 *
 * No server/db imports — the admin settings UI, the customer New-Ticket form,
 * and the DTO builder all import from here, so it must stay bundleable into the
 * client. Persistence lives in the server-only
 * `domains/settings/settings.tickets.ts` family, which parses against the same
 * schema defined here.
 */
import { z } from 'zod'
import { isValidTypeId, type TicketTypeId } from '@quackback/ids'
import type { TicketType, TicketStage, TicketStatusCategory } from '@/lib/shared/db-types'

/** Render a ticket's sequential number for display (plain `#142`). */
export function formatTicketNumber(n: number): string {
  return `#${n}`
}

/** Coerce an untrusted wire value to a registry ticket-type id: a well-formed
 *  `ticket_type` TypeID passes, anything else is dropped (a junk id never
 *  reaches the uuid-backed queries). Shared by the list/create server fns,
 *  the inbox fn + route search, and the v1 API. */
export function coerceTicketTypeId(value: string | null | undefined): TicketTypeId | undefined {
  return value && isValidTypeId(value, 'ticket_type') ? (value as TicketTypeId) : undefined
}

/** The workspace's default closed-category ticket status (unified inbox §3.4:
 *  "close"/"Resolve" maps to it for a ticket target) — the status marked
 *  `isDefault` within the closed category, or else the first closed status by
 *  position. Undefined when the workspace has no closed status configured at
 *  all. Shared by the inbox route's bulk/solo close and the unified thread
 *  header's primary Resolve button, so the resolution rule can't drift. */
export function resolveDefaultClosedStatusId(
  statuses: { id: string; category: string; isDefault: boolean }[] | undefined
): string | undefined {
  if (!statuses) return undefined
  const closed = statuses.filter((s) => s.category === 'closed')
  return closed.find((s) => s.isDefault)?.id ?? closed[0]?.id
}

/** The workspace's RESOLVED closed-category ticket status — the 'resolved'
 *  slug when the catalogue carries it, else the first closed status by
 *  position (the catalogue is ordered by category then position). Unlike
 *  `resolveDefaultClosedStatusId` (the workspace-configured default closed
 *  status, which a workspace can point at e.g. "Won't do"), this always means
 *  resolved, so it's the right target for a flow that resolves a ticket on
 *  the agent's behalf (the close-with-open-linked-ticket confirm) rather
 *  than merely closing it. */
export function resolveResolvedStatusId(
  statuses: { id: string; slug: string; category: string }[] | undefined
): string | undefined {
  if (!statuses) return undefined
  const closed = statuses.filter((s) => s.category === 'closed')
  return closed.find((s) => s.slug === 'resolved')?.id ?? closed[0]?.id
}

/** Customer-facing labels for the four requester stages. */
export type TicketStageLabels = Record<TicketStage, string>

/** Defaults shown to requesters when a workspace has not customized the labels. */
export const DEFAULT_TICKET_STAGE_LABELS: TicketStageLabels = {
  received: 'Received',
  in_progress: 'In progress',
  awaiting_requester: 'Awaiting your reply',
  resolved: 'Resolved',
}

/**
 * Display labels for the three status categories. The single source shared by the
 * settings status list, the workspace list-column filter, and the status chips.
 */
export const TICKET_STATUS_CATEGORY_LABELS: Record<TicketStatusCategory, string> = {
  open: 'Open',
  pending: 'Pending',
  closed: 'Closed',
}

/** The input controls a custom ticket-form field can render as. */
export const TICKET_FORM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'select',
  'date',
  'checkbox',
] as const
export type TicketFormFieldType = (typeof TICKET_FORM_FIELD_TYPES)[number]

/**
 * One configurable field on a ticket type's intake form. `visibleToCustomer`
 * decides whether it appears on the customer New-Ticket form; `options` is only
 * meaningful for `select`.
 */
export interface TicketFormField {
  key: string
  label: string
  type: TicketFormFieldType
  required: boolean
  visibleToCustomer: boolean
  order: number
  options?: string[]
}

/**
 * Validation for one intake-form field. The single source both the client editor
 * (inline validation) and the server write path parse against, so the two never
 * drift. A `select` field must define at least one option.
 */
export const ticketFormFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'Key must be lowercase letters, digits, and underscores'),
    label: z.string().trim().min(1).max(120),
    type: z.enum(TICKET_FORM_FIELD_TYPES),
    required: z.boolean(),
    visibleToCustomer: z.boolean(),
    order: z.number().int(),
    options: z.array(z.string().trim().min(1)).optional(),
  })
  .refine((f) => f.type !== 'select' || (f.options?.length ?? 0) > 0, {
    message: 'A select field must define at least one option',
    path: ['options'],
  })

/** A full intake form: an ordered field list rejecting duplicate keys. */
export const ticketFormSchema = z.array(ticketFormFieldSchema).superRefine((fields, ctx) => {
  const seen = new Set<string>()
  for (const f of fields) {
    if (seen.has(f.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate field key '${f.key}'` })
    }
    seen.add(f.key)
  }
})

/**
 * The wire shape of a `ticket_types` registry row (convergence Phase 4 —
 * user-defined types). A type is a label + icon + color + typed field set
 * WITHIN one of the three fixed categories; the category drives behavior, the
 * type defines the fields a ticket captures. Client-safe: the settings
 * registry, the create-dialog picker, the intake pickers, and the ticket-card
 * chip all code against this shape.
 */
export interface TicketTypeDTO {
  id: string
  name: string
  slug: string
  category: TicketType
  icon: string | null
  color: string
  fields: TicketFormField[]
  isDefault: boolean
  position: number
  /** Whether the type appears in the customer-category intake picker
   *  (portal + Messenger). Meaningful only for customer-category types. */
  intakeVisible: boolean
  /** Soft-deleted (archived): kept on ticket history, hidden from pickers. */
  archived: boolean
  /** Live tickets referencing the type; present only when the caller asked
   *  for usage (the manager's category-lock notice). */
  ticketCount?: number
}

/**
 * One intake-visible customer type as served to the portal + Messenger
 * New-Ticket forms (convergence Phase 4): the picker options and their
 * per-type field sets. `fields` carries only `visibleToCustomer` fields,
 * order-sorted — the shape `validateTicketIntakeValues` runs against.
 */
export interface TicketIntakeType {
  id: string
  name: string
  icon: string | null
  color: string
  /** Preselected in the intake picker (the customer-category default). */
  isDefault: boolean
  fields: TicketFormField[]
}

/** Upper bound on a stored text/long_text intake answer. Custom answers land in
 *  the ticket's `customAttributes` JSON, so — like the 4000-char description cap —
 *  a bound keeps an anonymous email-capture-tier visitor from writing unbounded
 *  blobs into the column. */
export const TICKET_INTAKE_TEXT_MAX_LENGTH = 4000

/** One field-level validation failure from `validateTicketIntakeValues`. */
export interface TicketIntakeError {
  key: string
  message: string
}

/**
 * Validate customer-submitted intake values against a ticket form and return the
 * cleaned, whitelisted value map. The single source both the client (inline
 * validation on the New-Ticket form) and the server write path run, so the two
 * never drift (mirrors the `ticketFormSchema` contract for the same reason).
 *
 * Only fields that are BOTH on the form AND `visibleToCustomer` are accepted;
 * any other key in `values` is dropped, never trusted (a hidden/admin-only or
 * unknown key can't be smuggled into `customAttributes`). Pass
 * `opts.includeInternal` on the AGENT path (the create dialog fills every field
 * of the chosen type, including customer-hidden ones). Per-type rules: a
 * required field must be present and non-empty; `select` must be one of its
 * `options`; `number` must be finite; `date` must be an ISO date; `checkbox`
 * must be a boolean. Coerces to the field's canonical stored type.
 */
export function validateTicketIntakeValues(
  form: TicketFormField[],
  values: Record<string, unknown>,
  opts?: { includeInternal?: boolean }
): { ok: true; values: Record<string, unknown> } | { ok: false; errors: TicketIntakeError[] } {
  const errors: TicketIntakeError[] = []
  const cleaned: Record<string, unknown> = {}

  for (const field of form) {
    if (!field.visibleToCustomer && !opts?.includeInternal) continue
    const raw = values[field.key]
    const missing =
      raw === undefined || raw === null || (typeof raw === 'string' && raw.trim().length === 0)

    if (missing) {
      if (field.required && field.type !== 'checkbox') {
        errors.push({ key: field.key, message: `${field.label} is required` })
      }
      // A required checkbox means "must be checked" — handled in its case below.
      if (field.type !== 'checkbox') continue
    }

    switch (field.type) {
      case 'text':
      case 'long_text': {
        const str = typeof raw === 'string' ? raw : String(raw ?? '')
        if (str.length > TICKET_INTAKE_TEXT_MAX_LENGTH) {
          errors.push({
            key: field.key,
            message: `${field.label} must be ${TICKET_INTAKE_TEXT_MAX_LENGTH} characters or less`,
          })
          break
        }
        cleaned[field.key] = str
        break
      }
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(num)) {
          errors.push({ key: field.key, message: `${field.label} must be a number` })
          break
        }
        cleaned[field.key] = num
        break
      }
      case 'select': {
        const str = typeof raw === 'string' ? raw : String(raw ?? '')
        if (!(field.options ?? []).includes(str)) {
          errors.push({ key: field.key, message: `${field.label} is not a valid option` })
          break
        }
        cleaned[field.key] = str
        break
      }
      case 'date': {
        const str = typeof raw === 'string' ? raw : ''
        // ISO date (YYYY-MM-DD) or full ISO datetime; must parse to a real date.
        if (!/^\d{4}-\d{2}-\d{2}/.test(str) || Number.isNaN(Date.parse(str))) {
          errors.push({ key: field.key, message: `${field.label} must be a valid date` })
          break
        }
        cleaned[field.key] = str
        break
      }
      case 'checkbox': {
        const bool = raw === true || raw === 'true'
        if (field.required && !bool) {
          errors.push({ key: field.key, message: `${field.label} is required` })
          break
        }
        cleaned[field.key] = bool
        break
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, values: cleaned }
}

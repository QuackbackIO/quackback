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
import type { TicketType, TicketStage, TicketStatusCategory } from '@/lib/shared/db-types'

/** Render a ticket's sequential number for display (plain `#142`). */
export function formatTicketNumber(n: number): string {
  return `#${n}`
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

/** The intake form for each ticket type (empty array = no custom fields). */
export type TicketForms = Record<TicketType, TicketFormField[]>

/** An empty form for every ticket type — the read-time default. */
export const DEFAULT_TICKET_FORMS: TicketForms = {
  customer: [],
  back_office: [],
  tracker: [],
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
 * unknown key can't be smuggled into `customAttributes`). Per-type rules: a
 * required field must be present and non-empty; `select` must be one of its
 * `options`; `number` must be finite; `date` must be an ISO date; `checkbox`
 * must be a boolean. Coerces to the field's canonical stored type.
 */
export function validateTicketIntakeValues(
  form: TicketFormField[],
  values: Record<string, unknown>
): { ok: true; values: Record<string, unknown> } | { ok: false; errors: TicketIntakeError[] } {
  const errors: TicketIntakeError[] = []
  const cleaned: Record<string, unknown> = {}

  for (const field of form) {
    if (!field.visibleToCustomer) continue
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

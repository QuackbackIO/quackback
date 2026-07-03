/**
 * Ticket settings families (support platform §4.2): the customer-facing stage
 * labels and the per-type intake forms.
 *
 * Storage: like office-hours, these ride in the generic `settings.metadata`
 * JSON bag (no dedicated column, no migration). Reads default at read time
 * (`DEFAULT_TICKET_STAGE_LABELS` / empty forms) so a workspace that never
 * customized them still resolves a complete set. The client-safe types + label
 * defaults live in `@/lib/shared/tickets`; this module owns the write-time zod
 * schemas and persistence.
 *
 * This family deliberately uses its own metadata keys instead of touching the
 * shared `settings.types.ts` / `settings.service.ts` so it composes without
 * colliding with concurrent settings work.
 */
import { z } from 'zod'
import { logger } from '@/lib/server/logger'
import { TICKET_STAGES, TICKET_TYPES } from '@/lib/shared/db-types'
import {
  DEFAULT_TICKET_STAGE_LABELS,
  DEFAULT_TICKET_FORMS,
  ticketFormSchema,
  type TicketStageLabels,
  type TicketFormField,
  type TicketForms,
} from '@/lib/shared/tickets'
import type { TicketType } from '@/lib/shared/db-types'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

export type { TicketStageLabels, TicketFormField, TicketForms }
export { DEFAULT_TICKET_STAGE_LABELS, DEFAULT_TICKET_FORMS }

const log = logger.child({ component: 'settings-tickets' })

/** Keys inside the `settings.metadata` JSON bag. */
const STAGE_LABELS_KEY = 'ticketStageLabels'
const FORMS_KEY = 'ticketForms'

// ---------------------------------------------------------------------------
// Write-time schemas
// ---------------------------------------------------------------------------

/** Partial map of stage -> label; missing slots fall back to the defaults. */
const stageLabelsSchema = z
  .object(
    Object.fromEntries(TICKET_STAGES.map((s) => [s, z.string().trim().min(1).max(60)])) as Record<
      (typeof TICKET_STAGES)[number],
      z.ZodString
    >
  )
  .partial()

// ---------------------------------------------------------------------------
// Metadata bag helpers
// ---------------------------------------------------------------------------

function parseMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {}
  try {
    return JSON.parse(metadataJson) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

/** Resolve the customer-facing stage labels, partial saves merged over defaults. */
export function resolveStageLabels(metadataJson: string | null): TicketStageLabels {
  const meta = parseMetadata(metadataJson)
  const parsed = stageLabelsSchema.safeParse(meta[STAGE_LABELS_KEY])
  return { ...DEFAULT_TICKET_STAGE_LABELS, ...(parsed.success ? parsed.data : {}) }
}

export async function getStageLabels(): Promise<TicketStageLabels> {
  try {
    const org = await requireSettings()
    return resolveStageLabels(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get stage labels failed')
    wrapDbError('fetch ticket stage labels', error)
  }
}

/** Persist a (possibly partial) label map; the merged full map is returned. */
export async function setStageLabels(
  input: Partial<TicketStageLabels>
): Promise<TicketStageLabels> {
  log.info('update ticket stage labels')
  try {
    const validated = stageLabelsSchema.parse(input)
    const merged = { ...DEFAULT_TICKET_STAGE_LABELS, ...validated }
    await writeMetadataKey(STAGE_LABELS_KEY, merged)
    return merged
  } catch (error) {
    log.error({ err: error }, 'update ticket stage labels failed')
    wrapDbError('update ticket stage labels', error)
  }
}

// ---------------------------------------------------------------------------
// Ticket forms
// ---------------------------------------------------------------------------

/** Resolve the per-type intake forms, defaulting any missing type to an empty form. */
export function resolveTicketForms(metadataJson: string | null): TicketForms {
  const meta = parseMetadata(metadataJson)
  const stored = (meta[FORMS_KEY] ?? {}) as Record<string, unknown>
  const forms = { ...DEFAULT_TICKET_FORMS }
  for (const type of TICKET_TYPES) {
    const parsed = ticketFormSchema.safeParse(stored[type])
    if (parsed.success) forms[type] = parsed.data
  }
  return forms
}

export async function getTicketForms(): Promise<TicketForms> {
  try {
    const org = await requireSettings()
    return resolveTicketForms(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get ticket forms failed')
    wrapDbError('fetch ticket forms', error)
  }
}

/** Persist the intake form for one ticket type; the full form map is returned. */
export async function setTicketForm(
  type: TicketType,
  fields: TicketFormField[]
): Promise<TicketForms> {
  log.info({ type }, 'update ticket form')
  try {
    const validated = ticketFormSchema.parse(fields)
    const org = await requireSettings()
    const forms = resolveTicketForms(org.metadata)
    forms[type] = validated
    await writeMetadataKey(FORMS_KEY, forms)
    return forms
  } catch (error) {
    log.error({ err: error }, 'update ticket form failed')
    wrapDbError('update ticket form', error)
  }
}

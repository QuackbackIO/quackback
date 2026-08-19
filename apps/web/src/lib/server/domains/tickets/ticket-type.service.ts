/**
 * Ticket type registry (convergence Phase 4, scratchpad/convergence-design.md).
 * A type is a label + icon + color + typed field set WITHIN one of the three
 * fixed categories; the category stays the BEHAVIOR axis (cascade rules,
 * portal visibility, SLA exclusion, the one-customer-ticket link rule) and is
 * derived onto `tickets.type` from the chosen type at write time.
 *
 * Rules enforced here:
 * - DEFAULT-PER-CATEGORY: exactly one live default per category (the partial
 *   unique index `ticket_types_one_default_per_category_uq`). Setting a new
 *   default unsettles the old one ATOMICALLY (one transaction). Unsetting the
 *   only default directly is refused — promote another type instead, so the
 *   create-dialog preselection and convert_to_ticket fallback always resolve.
 * - CATEGORY LOCK: a type's category can't change once tickets reference it
 *   (recategorizing would silently rewrite behavior on ticket history). The
 *   usage count is reported so the editor can show it.
 * - ARCHIVE, NEVER HARD-DELETE: archive is ALWAYS allowed — in-use types stay
 *   on ticket history (`tickets.ticket_type_id` keeps pointing at them); they
 *   just leave every picker. Restore clears the archive; if the category
 *   gained a new live default meanwhile, the restored row comes back
 *   non-default (the partial unique index would otherwise reject it).
 * - DERIVATION: `resolveTicketTypeForCreate` maps (ticketTypeId?, category?) to
 *   the pair written onto the ticket — the type's category wins, a mismatched
 *   explicit category is rejected.
 *
 * Permission gating (`ticket.manage_types`) lives in the server-fn layer,
 * mirroring ticket-status.service.ts. Customer-intake resolution (the portal/
 * Messenger picker set + `resolveIntakeCreate`) lives in the sibling
 * `ticket-type-intake.service.ts` (the max-lines budget).
 */
import {
  db,
  eq,
  and,
  isNull,
  asc,
  sql,
  ticketTypes,
  tickets,
  type TicketTypeEntity,
  type Transaction,
} from '@/lib/server/db'
import type { TicketTypeId } from '@quackback/ids'
import { TICKET_TYPES, type TicketType } from '@/lib/shared/db-types'
import { ticketFormSchema, type TicketFormField, type TicketTypeDTO } from '@/lib/shared/tickets'
import { slugify } from '@/lib/shared/utils/string'
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-types' })

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const NAME_MAX_LENGTH = 60
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_]*$/
const SLUG_MAX_LENGTH = 64

export interface CreateTicketTypeInput {
  name: string
  category: TicketType
  /** Explicit slug; derived from the name (unique-ified) when omitted. */
  slug?: string
  icon?: string | null
  color?: string
  fields?: TicketFormField[]
  intakeVisible?: boolean
  isDefault?: boolean
}

export interface UpdateTicketTypeInput {
  name?: string
  slug?: string
  category?: TicketType
  icon?: string | null
  color?: string
  fields?: TicketFormField[]
  intakeVisible?: boolean
  isDefault?: boolean
  position?: number
}

/** Ticket-type slugs use underscores (matching the seeded set + field keys). */
function toTypeSlug(name: string): string {
  return slugify(name).replace(/-/g, '_')
}

function validateSlug(slug: string): string {
  const trimmed = slug.trim()
  if (!SLUG_PATTERN.test(trimmed) || trimmed.length > SLUG_MAX_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Slug must start with a lowercase letter or digit and contain only lowercase letters, digits, and underscores'
    )
  }
  return trimmed
}

/** One live default per category: demote the incumbent inside the caller's
 *  transaction (the atomic swap — the partial unique index backstops a race
 *  either way). Shared by createTicketType and updateTicketType. */
async function unsettleCategoryDefault(tx: Transaction, category: TicketType): Promise<void> {
  await tx
    .update(ticketTypes)
    .set({ isDefault: false })
    .where(
      and(
        eq(ticketTypes.category, category),
        eq(ticketTypes.isDefault, true),
        isNull(ticketTypes.deletedAt)
      )
    )
}

/** A slug unique across all types (including archived — slug is globally unique). */
async function uniqueSlug(name: string): Promise<string> {
  const base = toTypeSlug(name) || 'type'
  const existing = await db
    .select({ slug: ticketTypes.slug })
    .from(ticketTypes)
    .where(sql`${ticketTypes.slug} = ${base} OR ${ticketTypes.slug} LIKE ${base + '_%'}`)
  const taken = new Set(existing.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

function validateName(name: string | undefined): string {
  const trimmed = name?.trim()
  if (!trimmed) throw new ValidationError('VALIDATION_ERROR', 'Name is required')
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Name must be ${NAME_MAX_LENGTH} characters or less`
    )
  }
  return trimmed
}

function validateColor(color: string | undefined): string {
  if (color === undefined) return '#6b7280'
  if (!HEX_COLOR.test(color)) {
    throw new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
  }
  return color
}

/** Parse a fields draft against the shared intake-form schema (the same zod
 *  the client editor runs, so the two never drift). */
function validateFields(fields: TicketFormField[] | undefined): TicketFormField[] {
  if (fields === undefined) return []
  return ticketFormSchema.parse(fields)
}

function validateCategory(category: TicketType | undefined): TicketType {
  if (!category || !TICKET_TYPES.includes(category)) {
    throw new ValidationError('VALIDATION_ERROR', 'A valid category is required')
  }
  return category
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** All ticket types, live first then archived, ordered by category + position. */
export async function listTicketTypes(opts?: {
  includeArchived?: boolean
  category?: TicketType
}): Promise<TicketTypeEntity[]> {
  const conditions = []
  if (!opts?.includeArchived) conditions.push(isNull(ticketTypes.deletedAt))
  if (opts?.category) conditions.push(eq(ticketTypes.category, opts.category))
  return db.query.ticketTypes.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [
      sql`CASE
        WHEN ${ticketTypes.category} = 'customer' THEN 0
        WHEN ${ticketTypes.category} = 'back_office' THEN 1
        WHEN ${ticketTypes.category} = 'tracker' THEN 2
      END`,
      asc(ticketTypes.position),
      asc(ticketTypes.name),
    ],
  })
}

/** Live + archived lookup by id (the editor + ticket-card chip need both:
 *  an archived type still renders on its ticket history). */
export async function getTicketType(id: TicketTypeId): Promise<TicketTypeEntity> {
  const row = await db.query.ticketTypes.findFirst({ where: eq(ticketTypes.id, id) })
  if (!row) throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Ticket type ${id} not found`)
  return row
}

/**
 * The type a category-scoped create falls back to when none is chosen: the
 * live default, else the first live type in the category, else null (a
 * category with no types at all creates typeless legacy-shaped tickets).
 */
export async function resolveCategoryDefaultType(
  category: TicketType
): Promise<TicketTypeEntity | null> {
  const live = await db.query.ticketTypes.findMany({
    where: and(eq(ticketTypes.category, category), isNull(ticketTypes.deletedAt)),
    orderBy: [asc(ticketTypes.position), asc(ticketTypes.name)],
  })
  return live.find((t) => t.isDefault) ?? live[0] ?? null
}

/** How many live tickets reference the type — drives the category lock and
 *  the editor's "N tickets use this type" notice. */
export async function countTicketsUsingType(id: TicketTypeId): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.ticketTypeId, id), isNull(tickets.deletedAt)))
  return Number(count)
}

/** Usage counts per type (live tickets only) in one grouped query — the
 *  manager's "N tickets" column without an N+1. */
export async function ticketTypeUsageMap(): Promise<Map<TicketTypeId, number>> {
  const rows = await db
    .select({ id: tickets.ticketTypeId, count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(sql`${tickets.ticketTypeId} IS NOT NULL`, isNull(tickets.deletedAt)))
    .groupBy(tickets.ticketTypeId)
  return new Map(rows.map((r) => [r.id as TicketTypeId, Number(r.count)]))
}

/** Project a registry row to its client-safe DTO (the settings manager, the
 *  create-dialog picker, and the intake pickers all consume this shape). */
export function ticketTypeToDTO(row: TicketTypeEntity, ticketCount?: number): TicketTypeDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    icon: row.icon,
    color: row.color,
    fields: row.fields,
    isDefault: row.isDefault,
    position: row.position,
    intakeVisible: row.intakeVisible,
    archived: row.deletedAt !== null,
    ...(ticketCount !== undefined ? { ticketCount } : {}),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTicketType(input: CreateTicketTypeInput): Promise<TicketTypeEntity> {
  log.debug({ name: input.name }, 'create ticket type')
  const name = validateName(input.name)
  const category = validateCategory(input.category)
  const color = validateColor(input.color)
  const fields = validateFields(input.fields)
  const slug = input.slug !== undefined ? validateSlug(input.slug) : await uniqueSlug(name)

  // Append after the current max position within the category.
  const [{ max }] = await db
    .select({ max: sql<number>`COALESCE(MAX(${ticketTypes.position}), -1)` })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.category, category), isNull(ticketTypes.deletedAt)))

  try {
    return await db.transaction(async (tx) => {
      if (input.isDefault) {
        // One default per category: unsettle the incumbent atomically with the
        // insert (the partial unique index backstops a race either way).
        await unsettleCategoryDefault(tx, category)
      }
      const [created] = await tx
        .insert(ticketTypes)
        .values({
          name,
          slug,
          category,
          icon: input.icon?.trim() || null,
          color,
          fields,
          intakeVisible: input.intakeVisible ?? true,
          isDefault: input.isDefault ?? false,
          position: Number(max) + 1,
        })
        .returning()
      return created
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    // The slug unique index is the only constraint a concurrent create can trip
    // (the default swap above pre-clears the partial one).
    throw new ConflictError('DUPLICATE_SLUG', `A ticket type with slug '${slug}' already exists`)
  }
}

export async function updateTicketType(
  id: TicketTypeId,
  patch: UpdateTicketTypeInput
): Promise<TicketTypeEntity> {
  log.debug({ ticket_type_id: id }, 'update ticket type')
  const existing = await db.query.ticketTypes.findFirst({
    where: and(eq(ticketTypes.id, id), isNull(ticketTypes.deletedAt)),
  })
  if (!existing) throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Ticket type ${id} not found`)

  const updateData: Partial<TicketTypeEntity> = {}
  if (patch.name !== undefined) updateData.name = validateName(patch.name)
  if (patch.slug !== undefined) updateData.slug = validateSlug(patch.slug)
  if (patch.color !== undefined) updateData.color = validateColor(patch.color)
  if (patch.icon !== undefined) updateData.icon = patch.icon?.trim() || null
  if (patch.fields !== undefined) updateData.fields = validateFields(patch.fields)
  if (patch.intakeVisible !== undefined) updateData.intakeVisible = patch.intakeVisible
  if (patch.position !== undefined) updateData.position = patch.position

  // CATEGORY LOCK: recategorizing an in-use type would silently rewrite the
  // behavior axis on its ticket history. Report the count so the editor can
  // show exactly what pins it.
  if (patch.category !== undefined && patch.category !== existing.category) {
    validateCategory(patch.category)
    const usage = await countTicketsUsingType(id)
    if (usage > 0) {
      throw new ForbiddenError(
        'TICKET_TYPE_CATEGORY_LOCKED',
        `Cannot change category: ${usage} ticket(s) use this type. Archive it and create a new type instead.`
      )
    }
    updateData.category = patch.category
  }

  // Default demotion is only allowed sideways: setting isDefault false on the
  // category's live default would leave the category with no default for the
  // create-dialog preselection / convert_to_ticket fallback. Promote another
  // type instead (the swap below keeps exactly one).
  if (patch.isDefault === false && existing.isDefault) {
    throw new ForbiddenError(
      'CANNOT_UNSET_DEFAULT',
      'Cannot unset the category default. Set another type as default instead.'
    )
  }

  try {
    return await db.transaction(async (tx) => {
      if (patch.isDefault === true && !existing.isDefault) {
        // The atomic default swap (see createTicketType).
        await unsettleCategoryDefault(tx, existing.category)
        updateData.isDefault = true
      }
      const [updated] = await tx
        .update(ticketTypes)
        .set(updateData)
        .where(and(eq(ticketTypes.id, id), isNull(ticketTypes.deletedAt)))
        .returning()
      if (!updated) {
        throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Ticket type ${id} not found`)
      }
      return updated
    })
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ValidationError ||
      error instanceof ForbiddenError
    ) {
      throw error
    }
    if (patch.slug !== undefined) {
      throw new ConflictError(
        'DUPLICATE_SLUG',
        `A ticket type with slug '${patch.slug}' already exists`
      )
    }
    throw error
  }
}

/**
 * Archive a type (soft delete). ALWAYS allowed: in-use types stay on ticket
 * history forever (`tickets.ticket_type_id` keeps resolving them), they only
 * leave every picker. An archived default stops resolving as the category
 * default (live-default resolution filters deleted_at) — the category falls
 * back to its next live type until an admin promotes one.
 */
export async function archiveTicketType(id: TicketTypeId): Promise<TicketTypeEntity> {
  log.debug({ ticket_type_id: id }, 'archive ticket type')
  const [updated] = await db
    .update(ticketTypes)
    .set({ deletedAt: new Date() })
    .where(and(eq(ticketTypes.id, id), isNull(ticketTypes.deletedAt)))
    .returning()
  if (!updated) throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Ticket type ${id} not found`)
  return updated
}

/**
 * Restore an archived type. Comes back NON-default when the category gained a
 * new live default meanwhile — the partial unique index admits at most one,
 * and silently demoting the incumbent would be the surprising direction.
 */
export async function restoreTicketType(id: TicketTypeId): Promise<TicketTypeEntity> {
  log.debug({ ticket_type_id: id }, 'restore ticket type')
  const existing = await db.query.ticketTypes.findFirst({ where: eq(ticketTypes.id, id) })
  if (!existing || !existing.deletedAt) {
    throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Archived ticket type ${id} not found`)
  }

  let restoreAsDefault = false
  if (existing.isDefault) {
    const liveDefault = await db.query.ticketTypes.findFirst({
      where: and(
        eq(ticketTypes.category, existing.category),
        eq(ticketTypes.isDefault, true),
        isNull(ticketTypes.deletedAt)
      ),
    })
    restoreAsDefault = !liveDefault
  }

  const [updated] = await db
    .update(ticketTypes)
    // restoreAsDefault is true only when the row WAS the default and the
    // category has no live default now; otherwise the row comes back
    // non-default regardless of its archived flag state.
    .set({ deletedAt: null, isDefault: restoreAsDefault })
    .where(and(eq(ticketTypes.id, id), sql`${ticketTypes.deletedAt} IS NOT NULL`))
    .returning()
  if (!updated)
    throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Archived ticket type ${id} not found`)
  return updated
}

// ---------------------------------------------------------------------------
// Write-time derivation (convergence Phase 4 model)
// ---------------------------------------------------------------------------

export interface ResolvedTicketType {
  /** What `tickets.type` (the behavior axis) must be written as. */
  category: TicketType
  ticketTypeId: TicketTypeId | null
}

/**
 * Resolve the (category, ticketTypeId) pair for a ticket create. The type's
 * category always wins — `tickets.type` is DERIVED from the chosen type, so a
 * caller that passes both a type and a mismatched explicit category is
 * rejected rather than silently reconciled. No type = the legacy typeless
 * path: the explicit category (or the column default) stands.
 */
export async function resolveTicketTypeForCreate(input: {
  ticketTypeId?: TicketTypeId | null
  category?: TicketType
}): Promise<ResolvedTicketType> {
  if (!input.ticketTypeId) {
    return { category: input.category ?? 'customer', ticketTypeId: null }
  }
  const type = await db.query.ticketTypes.findFirst({
    where: and(eq(ticketTypes.id, input.ticketTypeId), isNull(ticketTypes.deletedAt)),
  })
  if (!type) {
    throw new NotFoundError('TICKET_TYPE_NOT_FOUND', `Ticket type ${input.ticketTypeId} not found`)
  }
  if (input.category !== undefined && input.category !== type.category) {
    throw new ValidationError(
      'TICKET_TYPE_CATEGORY_MISMATCH',
      `Ticket type '${type.name}' belongs to category '${type.category}', not '${input.category}'`
    )
  }
  return { category: type.category, ticketTypeId: type.id }
}

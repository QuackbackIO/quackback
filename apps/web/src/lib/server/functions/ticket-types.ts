/**
 * Server functions for the ticket-type registry (convergence Phase 4,
 * scratchpad/convergence-design.md): the CRUD the settings manager drives,
 * plus the live-type listing the create-dialog + intake pickers read.
 *
 * Every function re-checks its permission independently of any route guard:
 * reads run under `ticket.view` (pickers are agent-wide), writes and the
 * archived/usage views under `ticket.manage_types`. The domain service
 * (dynamically imported so it never reaches the client bundle) owns the rules
 * — default-per-category atomicity, the in-use category lock, archive-not-
 * delete; these wrappers only validate input and delegate.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type { TicketTypeId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import { ticketFormSchema } from '@/lib/shared/tickets'
import { requireAuth } from './auth-helpers'

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')
const ticketTypeIdSchema = z.string().refine((v) => isValidTypeId(v, 'ticket_type'), {
  message: 'Invalid ticket type id',
})

const createTicketTypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  category: z.enum(TICKET_TYPES),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_]*$/, 'Lowercase letters, digits, and underscores')
    .max(64)
    .optional(),
  icon: z.string().trim().max(16).nullish(),
  color: hexColor.optional(),
  fields: ticketFormSchema.optional(),
  intakeVisible: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

const updateTicketTypeSchema = z.object({
  id: ticketTypeIdSchema,
  name: z.string().trim().min(1).max(60).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_]*$/, 'Lowercase letters, digits, and underscores')
    .max(64)
    .optional(),
  category: z.enum(TICKET_TYPES).optional(),
  icon: z.string().trim().max(16).nullish(),
  color: hexColor.optional(),
  fields: ticketFormSchema.optional(),
  intakeVisible: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  position: z.number().int().optional(),
})

export const listTicketTypesFn = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({
        includeArchived: z.boolean().optional(),
        withUsage: z.boolean().optional(),
        category: z.enum(TICKET_TYPES).optional(),
      })
      .optional()
  )
  .handler(async ({ data }) => {
    // Archived rows + usage counts are manager-facing; plain pickers (create
    // dialog, filters) only ever need the live set under ticket.view. Split
    // into two literal gates: the authz scanner must read each authority
    // statically (a computed ternary fails the reconciliation gate).
    const managerView = data?.includeArchived === true || data?.withUsage === true
    if (managerView) {
      await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    } else {
      await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    }
    const svc = await import('@/lib/server/domains/tickets/ticket-type.service')
    const rows = await svc.listTicketTypes({
      includeArchived: data?.includeArchived,
      category: data?.category,
    })
    const usage = data?.withUsage ? await svc.ticketTypeUsageMap() : undefined
    return rows.map((r) =>
      svc.ticketTypeToDTO(r, usage ? (usage.get(r.id as TicketTypeId) ?? 0) : undefined)
    )
  })

export const createTicketTypeFn = createServerFn({ method: 'POST' })
  .validator(createTicketTypeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const svc = await import('@/lib/server/domains/tickets/ticket-type.service')
    return svc.ticketTypeToDTO(await svc.createTicketType(data))
  })

export const updateTicketTypeFn = createServerFn({ method: 'POST' })
  .validator(updateTicketTypeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const svc = await import('@/lib/server/domains/tickets/ticket-type.service')
    const { id, ...patch } = data
    return svc.ticketTypeToDTO(await svc.updateTicketType(id as TicketTypeId, patch))
  })

export const archiveTicketTypeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: ticketTypeIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const svc = await import('@/lib/server/domains/tickets/ticket-type.service')
    return svc.ticketTypeToDTO(await svc.archiveTicketType(data.id as TicketTypeId))
  })

export const restoreTicketTypeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: ticketTypeIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TICKET_MANAGE_TYPES })
    const svc = await import('@/lib/server/domains/tickets/ticket-type.service')
    return svc.ticketTypeToDTO(await svc.restoreTicketType(data.id as TicketTypeId))
  })

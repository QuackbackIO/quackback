/**
 * Server functions for conversation attribute definitions + values. Reading
 * the registry needs conversation.view (every picker and the inbox panel);
 * defining/archiving needs conversation.manage; writing a VALUE onto a
 * conversation or ticket always records src 'teammate' (workflow/AI writers
 * call the domain writer directly). The required permission depends on the
 * target (conversation.set_attributes vs ticket.set_status), so that gate is
 * bare and asserted per-branch — see setConversationAttributeValueFn.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationAttributeId, ConversationId, TicketId } from '@quackback/ids'
import { requireAuth, assertPermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ValidationError } from '@/lib/shared/errors'
import {
  listConversationAttributes,
  createConversationAttribute,
  updateConversationAttribute,
  archiveConversationAttribute,
  restoreConversationAttribute,
} from '@/lib/server/domains/conversation-attributes/conversation-attribute.service'
import {
  setConversationAttribute,
  type SetAttributeTarget,
} from '@/lib/server/domains/conversation-attributes/set-attribute.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-attributes-fns' })

const fieldTypeSchema = z.enum(['text', 'number', 'select', 'multi_select', 'checkbox', 'date'])
const sourceHintSchema = z.enum(['ai', 'workflow', 'agent'])

const createOptionSchema = z.object({
  label: z.string().min(1).max(100),
  description: z.string().max(512).optional().nullable(),
})
const updateOptionSchema = createOptionSchema.extend({
  id: z.string().min(1).optional(),
})

const listAttributesSchema = z.object({ includeArchived: z.boolean().optional() }).optional()

const createAttributeSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  description: z.string().max(512).optional().nullable(),
  fieldType: fieldTypeSchema,
  options: z.array(createOptionSchema).max(100).optional(),
  requiredToClose: z.boolean().optional(),
  sourceHint: sourceHintSchema.optional().nullable(),
})

// Field type (and key) are immutable after creation, so neither is accepted.
const updateAttributeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional().nullable(),
  options: z.array(updateOptionSchema).max(100).optional(),
  requiredToClose: z.boolean().optional(),
  sourceHint: sourceHintSchema.optional().nullable(),
})

const attributeIdSchema = z.object({ id: z.string().min(1) })

const setAttributeValueSchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    ticketId: z.string().min(1).optional(),
    key: z.string().min(1).max(64),
    // Typed validation happens against the definition in the domain writer.
    value: z.unknown(),
  })
  .refine((d) => Boolean(d.conversationId) !== Boolean(d.ticketId), {
    message: 'Provide exactly one of conversationId or ticketId',
  })

/** Definitions for pickers + the inbox panel (non-archived by default). */
export const listConversationAttributesFn = createServerFn({ method: 'GET' })
  .validator(listAttributesSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      return listConversationAttributes({ includeArchived: data?.includeArchived })
    } catch (error) {
      log.error({ err: error }, 'list conversation attributes failed')
      throw error
    }
  })

export const createConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(createAttributeSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
      return createConversationAttribute(data)
    } catch (error) {
      log.error({ err: error }, 'create conversation attribute failed')
      throw error
    }
  })

export const updateConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(updateAttributeSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
      const { id, ...input } = data
      return updateConversationAttribute(id as ConversationAttributeId, input)
    } catch (error) {
      log.error({ err: error }, 'update conversation attribute failed')
      throw error
    }
  })

export const archiveConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(attributeIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
      return archiveConversationAttribute(data.id as ConversationAttributeId)
    } catch (error) {
      log.error({ err: error }, 'archive conversation attribute failed')
      throw error
    }
  })

export const restoreConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(attributeIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
      return restoreConversationAttribute(data.id as ConversationAttributeId)
    } catch (error) {
      log.error({ err: error }, 'restore conversation attribute failed')
      throw error
    }
  })

/**
 * Teammate inline edit from the inbox panel: one attribute value, on a
 * conversation or a ticket (unified inbox §3.5). The permission required
 * depends on the target, so the gate is bare and the per-target permission is
 * asserted at runtime instead of declared statically (mirrors
 * bulkUpdateConversationsFn's action-dependent gate; the closed set is
 * declared in the authz-matrix classifications). There is no dedicated
 * ticket-attribute permission in the catalogue, so a ticket target gates on
 * ticket.set_status — the closest lifecycle verb, the same precedent
 * softDeleteTicket uses for the same reason.
 */
export const setConversationAttributeValueFn = createServerFn({ method: 'POST' })
  .validator(setAttributeValueSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      let target: SetAttributeTarget
      if (data.conversationId) {
        if (!isValidTypeId(data.conversationId, 'conversation')) {
          throw new ValidationError('VALIDATION_ERROR', 'Invalid conversation id')
        }
        assertPermission(ctx.principal.role, PERMISSIONS.CONVERSATION_SET_ATTRIBUTES)
        target = { conversationId: data.conversationId as ConversationId }
      } else {
        if (!data.ticketId || !isValidTypeId(data.ticketId, 'ticket')) {
          throw new ValidationError('VALIDATION_ERROR', 'Invalid ticket id')
        }
        assertPermission(ctx.principal.role, PERMISSIONS.TICKET_SET_STATUS)
        target = { ticketId: data.ticketId as TicketId }
      }

      const customAttributes = await setConversationAttribute(
        target,
        data.key,
        data.value ?? null,
        'teammate'
      )
      return { customAttributes }
    } catch (error) {
      log.error({ err: error }, 'set conversation attribute value failed')
      throw error
    }
  })

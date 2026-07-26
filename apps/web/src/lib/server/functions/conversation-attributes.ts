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
import { previewAttributeDetection } from '@/lib/server/domains/conversation-attributes/attribute-preview.service'
import { draftAttributeDescriptions } from '@/lib/server/domains/conversation-attributes/attribute-description-draft.service'
import { attributeValueCounts } from '@/lib/server/domains/conversation-attributes/attribute-value-counts.service'

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
  // select-only, enforced at the service layer (createConversationAttribute).
  aiDetect: z.boolean().optional(),
  detectOnClose: z.boolean().optional(),
})

// Field type (and key) are immutable after creation, so neither is accepted.
const updateAttributeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional().nullable(),
  options: z.array(updateOptionSchema).max(100).optional(),
  requiredToClose: z.boolean().optional(),
  sourceHint: sourceHintSchema.optional().nullable(),
  // select-only, enforced at the service layer (updateConversationAttribute).
  aiDetect: z.boolean().optional(),
  detectOnClose: z.boolean().optional(),
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
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    return listConversationAttributes({ includeArchived: data?.includeArchived })
  })

export const createConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(createAttributeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return createConversationAttribute(data)
  })

export const updateConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(updateAttributeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    const { id, ...input } = data
    return updateConversationAttribute(id as ConversationAttributeId, input)
  })

export const archiveConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(attributeIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return archiveConversationAttribute(data.id as ConversationAttributeId)
  })

export const restoreConversationAttributeFn = createServerFn({ method: 'POST' })
  .validator(attributeIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return restoreConversationAttribute(data.id as ConversationAttributeId)
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
    const ctx = await requireAuth()
    let target: SetAttributeTarget
    if (data.conversationId) {
      if (!isValidTypeId(data.conversationId, 'conversation')) {
        throw new ValidationError('VALIDATION_ERROR', 'Invalid conversation id')
      }
      assertPermission(ctx, PERMISSIONS.CONVERSATION_SET_ATTRIBUTES)
      target = { conversationId: data.conversationId as ConversationId }
    } else {
      if (!data.ticketId || !isValidTypeId(data.ticketId, 'ticket')) {
        throw new ValidationError('VALIDATION_ERROR', 'Invalid ticket id')
      }
      assertPermission(ctx, PERMISSIONS.TICKET_SET_STATUS)
      target = { ticketId: data.ticketId as TicketId }
    }

    const customAttributes = await setConversationAttribute(
      target,
      data.key,
      data.value ?? null,
      'teammate'
    )
    return { customAttributes }
  })

const previewOptionSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1).max(100),
  description: z.string().max(512).optional().nullable(),
})

const previewAttributeDetectionSchema = z.object({
  definition: z.object({
    // Absent/blank for an unsaved, mid-creation definition — the service
    // falls back to an ephemeral key for the classification call itself.
    key: z.string().max(64).optional(),
    label: z.string().min(1).max(128),
    description: z.string().max(512).optional().nullable(),
    options: z.array(previewOptionSchema).max(100),
  }),
  sampleMessage: z.string().min(1).max(4000),
})

/**
 * Preview harness (AI-ATTRIBUTES-PARITY-SPEC.md Phase 3): test AI detection
 * against a sample message from inside the editor, before (or after) saving.
 * Gated conversation.manage, like every other definition-authoring fn — the
 * flag/AI-config/budget gates live in the service (previewAttributeDetection
 * throws a typed error for each, which the editor surfaces via toast).
 */
export const previewAttributeDetectionFn = createServerFn({ method: 'POST' })
  .validator(previewAttributeDetectionSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    // New (not-yet-saved) options have no id; a positional placeholder is
    // fine here since it's only ever used within this one ephemeral call,
    // never persisted or compared across requests.
    const options = data.definition.options.map((o, i) => ({
      id: o.id ?? `preview_opt_${i}`,
      label: o.label,
      description: o.description ?? null,
    }))
    return await previewAttributeDetection({
      definition: {
        key: data.definition.key,
        label: data.definition.label,
        description: data.definition.description ?? null,
        options,
      },
      sampleMessage: data.sampleMessage,
    })
  })

const draftAttributeDescriptionsSchema = z.object({
  label: z.string().min(1).max(128),
  optionLabels: z.array(z.string().min(1).max(100)).min(1).max(100),
})

/**
 * "Draft descriptions" authoring assist (AI-ATTRIBUTES-PARITY-SPEC.md Phase
 * 3): fills the attribute + option description fields from just the labels,
 * for the admin to review/edit before saving. Gated conversation.manage.
 */
export const draftAttributeDescriptionsFn = createServerFn({ method: 'POST' })
  .validator(draftAttributeDescriptionsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return await draftAttributeDescriptions(data)
  })

const attributeValueCountsSchema = z.object({
  key: z.string().min(1).max(64),
  sinceDays: z.number().int().positive().max(365).optional(),
})

/**
 * Monitoring (AI-ATTRIBUTES-PARITY-SPEC.md Phase 3): per-option detection
 * counts for one attribute over a rolling window, for the editor's
 * read-only breakdown. Read-only, so gated conversation.view (same as the
 * registry list) rather than conversation.manage.
 */
export const attributeValueCountsFn = createServerFn({ method: 'GET' })
  .validator(attributeValueCountsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    return await attributeValueCounts(data)
  })

/**
 * Conversation attribute registry — admin-defined data attributes for
 * conversations and tickets, keyed into their `custom_attributes` jsonb.
 * Mirrors the user-attributes service, plus the semantics the registry
 * locks in: type immutability, option append/rename-by-id (no removal),
 * and an archive-only lifecycle (no hard delete; archived keys stay
 * reserved by the unique index). Authorization lives at the server-fn layer.
 */
import { randomUUID } from 'node:crypto'
import { db, eq, asc, and, isNull, conversationAttributeDefinitions } from '@/lib/server/db'
import type { ConversationAttributeOption } from '@/lib/server/db'
import type { ConversationAttributeId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import type {
  ConversationAttribute,
  CreateConversationAttributeInput,
  UpdateConversationAttributeInput,
  UpdateAttributeOptionInput,
} from './conversation-attribute.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-attributes' })

const SELECT_TYPES: ReadonlySet<string> = new Set(['select', 'multi_select'])

export const ASSISTANT_ESCALATION_REASON_KEY = 'assistant_escalation_reason'

/** Normalize a machine key: trimmed, lowercased, whitespace to underscores. */
export function normalizeAttributeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

function rowToAttribute(
  row: typeof conversationAttributeDefinitions.$inferSelect
): ConversationAttribute {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    fieldType: row.fieldType,
    options: row.options,
    requiredToClose: row.requiredToClose,
    sourceHint: row.sourceHint,
    aiDetect: row.aiDetect,
    detectOnClose: row.detectOnClose,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Mint options with stable generated ids (the id is what values store). */
function buildOptions(
  inputs: { label: string; description?: string | null }[]
): ConversationAttributeOption[] {
  return inputs.map((o) => {
    const label = o.label?.trim()
    if (!label) throw new ValidationError('VALIDATION_ERROR', 'Option label is required')
    return { id: `opt_${randomUUID()}`, label, description: o.description?.trim() || null }
  })
}

function validateOptionsForType(fieldType: string, options: { label: string }[] | undefined): void {
  if (SELECT_TYPES.has(fieldType)) {
    if (!options || options.length === 0) {
      throw new ValidationError('VALIDATION_ERROR', 'Select attributes need at least one option')
    }
  } else if (options && options.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Only select attributes can have options')
  }
}

/**
 * AI classification (`aiDetect`/`detectOnClose`) is `select`-only, matching
 * both competitor references (which classify enum attributes only) —
 * `multi_select` is a deliberate v1 exclusion, not yet supported by
 * the classifier. Only checked when a caller actually sets one of the flags
 * true, so a plain text/number/etc. attribute update untouched by this
 * feature never has to pass `false` explicitly.
 */
function validateAiDetectForType(
  fieldType: string,
  aiDetect: boolean | undefined,
  detectOnClose: boolean | undefined
): void {
  if ((aiDetect || detectOnClose) && fieldType !== 'select') {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'AI detection is only available on select attributes'
    )
  }
}

/**
 * Non-archived definitions by default; the settings page lists everything.
 * `aiDetectOnly` narrows to `aiDetect=true` definitions — the classifier's
 * enabled-definitions read.
 */
export async function listConversationAttributes(opts?: {
  includeArchived?: boolean
  aiDetectOnly?: boolean
}): Promise<ConversationAttribute[]> {
  try {
    const conditions = [
      opts?.includeArchived ? undefined : isNull(conversationAttributeDefinitions.archivedAt),
      opts?.aiDetectOnly ? eq(conversationAttributeDefinitions.aiDetect, true) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined)
    const rows = await db
      .select()
      .from(conversationAttributeDefinitions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(conversationAttributeDefinitions.label))
    return rows.map(rowToAttribute)
  } catch (error) {
    log.error({ err: error }, 'failed to list conversation attributes')
    throw new InternalError('DATABASE_ERROR', 'Failed to list conversation attributes', error)
  }
}

/** Seed the system select used by handoff so the builder can branch on it. */
export async function ensureAssistantEscalationReasonAttribute(): Promise<void> {
  const [existing] = await db
    .select({ id: conversationAttributeDefinitions.id })
    .from(conversationAttributeDefinitions)
    .where(eq(conversationAttributeDefinitions.key, ASSISTANT_ESCALATION_REASON_KEY))
    .limit(1)
  if (existing) return
  const { ASSISTANT_HANDOFF_REASONS } = await import('@/lib/server/db')
  const { HANDOFF_REASON_LABELS } = await import('@/lib/shared/conversation/types')
  try {
    await db.insert(conversationAttributeDefinitions).values({
      key: ASSISTANT_ESCALATION_REASON_KEY,
      label: 'Escalation reason',
      description: 'Why the AI agent handed this conversation to the team.',
      fieldType: 'select',
      options: ASSISTANT_HANDOFF_REASONS.map((reason) => ({
        id: reason,
        label: HANDOFF_REASON_LABELS[reason] ?? reason,
      })),
      sourceHint: 'ai',
      aiDetect: false,
      detectOnClose: false,
    })
  } catch (err) {
    if (isUniqueViolation(err)) return
    throw err
  }
}

export async function createConversationAttribute(
  input: CreateConversationAttributeInput
): Promise<ConversationAttribute> {
  try {
    const key = normalizeAttributeKey(input.key ?? '')
    if (!key) throw new ValidationError('VALIDATION_ERROR', 'Attribute key is required')
    if (!input.label?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Attribute label is required')
    }
    validateOptionsForType(input.fieldType, input.options)
    validateAiDetectForType(input.fieldType, input.aiDetect, input.detectOnClose)

    const [row] = await db
      .insert(conversationAttributeDefinitions)
      .values({
        key,
        label: input.label.trim(),
        description: input.description?.trim() || null,
        fieldType: input.fieldType,
        options: SELECT_TYPES.has(input.fieldType) ? buildOptions(input.options!) : null,
        requiredToClose: input.requiredToClose ?? false,
        sourceHint: input.sourceHint ?? null,
        // AI classification is on by default where supported (select), so
        // Quinn assigns attributes automatically unless the author opts out.
        aiDetect: input.aiDetect ?? input.fieldType === 'select',
        detectOnClose: input.detectOnClose ?? false,
      })
      .returning()
    return rowToAttribute(row)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    if (isUniqueViolation(error)) {
      // Archived definitions keep their key reserved, so this covers them too.
      throw new ConflictError('DUPLICATE_KEY', 'An attribute with that key already exists')
    }
    log.error({ err: error }, 'failed to create conversation attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to create conversation attribute', error)
  }
}

/**
 * Merge submitted options into the existing set: every existing id must be
 * present (rename/redescribe only — removal would orphan stored values), and
 * entries without an id append as new options.
 */
function mergeOptions(
  existing: ConversationAttributeOption[],
  submitted: UpdateAttributeOptionInput[]
): ConversationAttributeOption[] {
  const existingById = new Map(existing.map((o) => [o.id, o]))
  const seen = new Set<string>()
  const merged = submitted.map((o) => {
    if (o.id !== undefined) {
      if (!existingById.has(o.id)) {
        throw new ValidationError('VALIDATION_ERROR', `Unknown option id ${o.id}`)
      }
      seen.add(o.id)
    }
    const label = o.label?.trim()
    if (!label) throw new ValidationError('VALIDATION_ERROR', 'Option label is required')
    return {
      id: o.id ?? `opt_${randomUUID()}`,
      label,
      description: o.description?.trim() || null,
    }
  })
  const missing = existing.filter((o) => !seen.has(o.id))
  if (missing.length > 0) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Options cannot be removed (values may reference them): ${missing.map((o) => o.label).join(', ')}`
    )
  }
  return merged
}

export async function updateConversationAttribute(
  id: ConversationAttributeId,
  input: UpdateConversationAttributeInput
): Promise<ConversationAttribute> {
  try {
    // Defense-in-depth for the locked rule; the input type already omits it.
    if ('fieldType' in input || 'key' in input) {
      throw new ValidationError('VALIDATION_ERROR', 'Attribute key and type cannot be changed')
    }
    const existing = await db.query.conversationAttributeDefinitions.findFirst({
      where: eq(conversationAttributeDefinitions.id, id),
    })
    if (!existing) {
      throw new NotFoundError('ATTRIBUTE_NOT_FOUND', `Conversation attribute ${id} not found`)
    }

    const updates: Partial<typeof conversationAttributeDefinitions.$inferInsert> = {}
    if (input.label !== undefined) {
      if (!input.label.trim()) {
        throw new ValidationError('VALIDATION_ERROR', 'Attribute label is required')
      }
      updates.label = input.label.trim()
    }
    if (input.description !== undefined) updates.description = input.description?.trim() || null
    if (input.requiredToClose !== undefined) updates.requiredToClose = input.requiredToClose
    if (input.sourceHint !== undefined) updates.sourceHint = input.sourceHint
    if (input.aiDetect !== undefined || input.detectOnClose !== undefined) {
      // Field type is immutable, so the existing row's type is the one
      // that ever needs checking, regardless of which of the two flags
      // this call is touching.
      validateAiDetectForType(existing.fieldType, input.aiDetect, input.detectOnClose)
      if (input.aiDetect !== undefined) updates.aiDetect = input.aiDetect
      if (input.detectOnClose !== undefined) updates.detectOnClose = input.detectOnClose
    }
    if (input.options !== undefined) {
      if (!SELECT_TYPES.has(existing.fieldType)) {
        throw new ValidationError('VALIDATION_ERROR', 'Only select attributes can have options')
      }
      updates.options = mergeOptions(existing.options ?? [], input.options)
    }

    if (Object.keys(updates).length === 0) return rowToAttribute(existing)

    const [row] = await db
      .update(conversationAttributeDefinitions)
      .set(updates)
      .where(eq(conversationAttributeDefinitions.id, id))
      .returning()
    return rowToAttribute(row)
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    log.error({ err: error }, 'failed to update conversation attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to update conversation attribute', error)
  }
}

async function setArchived(
  id: ConversationAttributeId,
  archivedAt: Date | null
): Promise<ConversationAttribute> {
  const [row] = await db
    .update(conversationAttributeDefinitions)
    .set({ archivedAt })
    .where(eq(conversationAttributeDefinitions.id, id))
    .returning()
  if (!row) {
    throw new NotFoundError('ATTRIBUTE_NOT_FOUND', `Conversation attribute ${id} not found`)
  }
  return rowToAttribute(row)
}

/** Archive: hidden from pickers, values intact, key reserved. Idempotent. */
export async function archiveConversationAttribute(
  id: ConversationAttributeId
): Promise<ConversationAttribute> {
  try {
    return await setArchived(id, new Date())
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    log.error({ err: error }, 'failed to archive conversation attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to archive conversation attribute', error)
  }
}

/** Bring an archived definition back into pickers. Idempotent. */
export async function restoreConversationAttribute(
  id: ConversationAttributeId
): Promise<ConversationAttribute> {
  try {
    return await setArchived(id, null)
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    log.error({ err: error }, 'failed to restore conversation attribute')
    throw new InternalError('DATABASE_ERROR', 'Failed to restore conversation attribute', error)
  }
}

import { db, settings, eq, sql } from '@/lib/server/db'
import { ConflictError, ValidationError } from '@/lib/shared/errors'
import {
  DEFAULT_CONVERSATION_INACTIVITY,
  conversationInactivitySchema,
  updateConversationInactivitySchema,
  inactivityValidation,
  type ConversationInactivitySettings,
  type UpdateConversationInactivityInput,
} from '@/lib/shared/conversation-inactivity'
import { requireSettings, invalidateSettingsCache } from './settings.helpers'
export { DEFAULT_CONVERSATION_INACTIVITY }
export type { ConversationInactivitySettings, UpdateConversationInactivityInput }

export function resolveConversationInactivity(
  metadataJson: string | null
): ConversationInactivitySettings {
  try {
    const parsed = conversationInactivitySchema.safeParse(
      JSON.parse(metadataJson ?? '{}')?.conversationInactivity
    )
    if (!parsed.success) return structuredClone(DEFAULT_CONVERSATION_INACTIVITY)
    const stored = parsed.data
    return {
      ...DEFAULT_CONVERSATION_INACTIVITY,
      ...stored,
      version: 2,
      assistant: {
        ...DEFAULT_CONVERSATION_INACTIVITY.assistant,
        ...stored.assistant,
        email: {
          ...DEFAULT_CONVERSATION_INACTIVITY.assistant.email,
          // Snapshot legacy shared choices into email once. Editing Chat must
          // never change the independently saved Email policy afterward.
          ...(stored.assistant?.closeWhenAnswered !== undefined
            ? { closeWhenAnswered: stored.assistant.closeWhenAnswered }
            : {}),
          ...(stored.assistant?.closeWhenUnanswered !== undefined
            ? { closeWhenUnanswered: stored.assistant.closeWhenUnanswered }
            : {}),
          ...(stored.assistant?.closingMessage !== undefined
            ? { closingMessage: stored.assistant.closingMessage }
            : {}),
          ...stored.assistant?.email,
        },
      },
      messenger: { ...DEFAULT_CONVERSATION_INACTIVITY.messenger, ...stored.messenger },
      email: { ...DEFAULT_CONVERSATION_INACTIVITY.email, ...stored.email },
    }
  } catch {
    return structuredClone(DEFAULT_CONVERSATION_INACTIVITY)
  }
}

export async function getConversationInactivitySettings(): Promise<ConversationInactivitySettings> {
  const org = await requireSettings()
  return resolveConversationInactivity(org.metadata)
}

export async function updateConversationInactivitySettings(
  input: UpdateConversationInactivityInput
): Promise<ConversationInactivitySettings> {
  const data = updateConversationInactivitySchema.parse(input)
  const result = await db.transaction(async (tx) => {
    // Settings row first, then conversation rows: workers use the same lock order.
    const [org] = await tx.select().from(settings).limit(1).for('update')
    const current = resolveConversationInactivity(org.metadata)
    if ((current.revision ?? 0) !== data.revision)
      throw new ConflictError(
        'INACTIVITY_CONFLICT',
        'Conversation settings changed. Reload the saved settings before trying again. Your draft is still available.'
      )
    const next: ConversationInactivitySettings = {
      ...current,
      version: 2,
      revision: data.revision + 1,
    }
    if (data.section === 'assistant')
      next.assistant = {
        ...current.assistant,
        ...data.policy,
        email: { ...current.assistant.email, ...data.policy.email },
      }
    else {
      if (data.section === 'messenger') next.messenger = { ...current.messenger, ...data.policy }
      else next.email = { ...current.email, ...data.policy }
      next.channels = {
        messenger: 'built_in',
        email: 'built_in',
        ...current.channels,
        ...(data.mode ? { [data.section]: data.mode } : {}),
      }
    }
    const error = inactivityValidation(next, data.section)
    if (error) throw new ValidationError('INVALID_INACTIVITY_TIMING', error)
    await tx
      .update(settings)
      .set({
        metadata: sql`jsonb_set(COALESCE(NULLIF(${settings.metadata}, '')::jsonb, '{}'::jsonb), '{conversationInactivity}', ${JSON.stringify(next)}::jsonb)::text`,
      })
      .where(eq(settings.id, org.id))
    if (
      data.section !== 'assistant' &&
      data.mode &&
      data.mode !== current.channels?.[data.section]
    ) {
      // Interrupt only inactivity-triggered runs; interactive journeys retain ownership.
      await tx.execute(sql`UPDATE workflow_runs r SET state = 'interrupted', ended_at = now()
        FROM workflows w, conversations c
        WHERE r.workflow_id = w.id AND r.conversation_id = c.id
          AND w.trigger_type = 'conversation.customer_unresponsive'
          AND c.channel = ${data.section} AND r.state IN ('running', 'waiting')`)
    }
    return next
  })
  await invalidateSettingsCache()
  return result
}

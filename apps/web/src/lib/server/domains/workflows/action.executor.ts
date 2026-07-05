/**
 * The workflow Action executor (support platform §4.6, Slice 3). ONE
 * `applyAction(action, ctx)` runs a single action against a conversation, shared
 * by macros ("a bundle of actions with no trigger") and the workflow engine (a
 * bundle of actions with a trigger + conditions). Keeping the catalogue in one
 * place means a new action is wired once and both surfaces get it.
 *
 * Each action is an independent unit that dispatches to the existing conversation
 * services and returns a short label of what happened (null = a deferred no-op).
 * It THROWS on failure so the caller owns the policy: macros apply best-effort
 * (catch + skip), the engine can fail-fast or continue per its run semantics.
 *
 * Author-bearing actions (send message / add note as a persona), the CSAT
 * request, ticket conversion, and `wait` are engine-coupled and land with the
 * engine slice. `set_attribute` writes through the shared domain writer, with
 * provenance derived from the actor: a macro runs as the invoking agent
 * (src teammate), the engine's service actor records src workflow.
 */
import type {
  ConversationId,
  PrincipalId,
  TeamId,
  ConversationTagId,
  SlaPolicyId,
} from '@quackback/ids'
import type { ConversationPriority } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'

import * as conversationService from '@/lib/server/domains/conversation/conversation.service'
import * as tagService from '@/lib/server/domains/conversation/conversation-tag.service'
import { applySlaToConversation } from '@/lib/server/domains/sla/sla.service'
import { setConversationAttribute } from '@/lib/server/domains/conversation-attributes/set-attribute.service'

/** What an action runs against: the target conversation + the acting principal
 *  (the teammate for a macro, a workflow service actor for the engine). The
 *  condition evaluator (Slice 4) extends this with the resolved person/message
 *  snapshot; actions only need these two. */
export interface WorkflowContext {
  conversationId: ConversationId
  actor: Actor
}

/** The v1 action catalogue this executor applies today. */
export type WorkflowAction =
  | { type: 'assign_agent'; principalId: PrincipalId }
  | { type: 'assign_team'; teamId: TeamId }
  | { type: 'add_tag'; tagId: ConversationTagId }
  | { type: 'remove_tag'; tagId: ConversationTagId }
  | { type: 'set_priority'; priority: ConversationPriority }
  // untilIso is an ISO timestamp (JSON-safe so it round-trips through the stored
  // graph) or null = until the customer next replies. A relative wake time is
  // resolved to an absolute one by the caller before it reaches here.
  | { type: 'snooze'; untilIso: string | null }
  | { type: 'close' }
  | { type: 'apply_sla'; policyId: SlaPolicyId }
  | { type: 'set_attribute'; key: string; value: unknown }

/**
 * Apply one action to the conversation in `ctx`. Returns a short label of what
 * happened, or null for a deferred no-op. Throws on failure — the caller decides
 * whether to continue.
 */
export async function applyAction(
  action: WorkflowAction,
  ctx: WorkflowContext
): Promise<string | null> {
  const { conversationId, actor } = ctx
  switch (action.type) {
    case 'assign_agent':
      await conversationService.assignConversation(conversationId, action.principalId, actor)
      return 'assigned'
    case 'assign_team':
      await conversationService.assignTeam(conversationId, action.teamId, actor)
      return 'assigned to team'
    case 'add_tag':
      await tagService.attachTag(conversationId, action.tagId)
      return 'tagged'
    case 'remove_tag':
      await tagService.detachTag(conversationId, action.tagId)
      return 'untagged'
    case 'set_priority':
      await conversationService.setConversationPriority(conversationId, action.priority, actor)
      return `priority ${action.priority}`
    case 'snooze':
      await conversationService.snoozeConversation(
        conversationId,
        action.untilIso ? new Date(action.untilIso) : null,
        actor
      )
      return 'snoozed'
    case 'close':
      await conversationService.setConversationStatus(conversationId, 'closed', actor)
      return 'closed'
    case 'apply_sla':
      await applySlaToConversation(conversationId, action.policyId)
      return 'SLA applied'
    case 'set_attribute':
      // Provenance follows the actor: the engine's synthetic service actor is
      // a workflow write; a human actor (macro) is the invoking teammate.
      await setConversationAttribute(
        { conversationId },
        action.key,
        action.value,
        actor.principalType === 'service' ? 'workflow' : 'teammate'
      )
      return `set ${action.key}`
  }
}

/**
 * A macro is "a bundle of actions with no trigger": its bundled actions run
 * through the shared workflow action executor (§4.6, Slice 3), so macros and
 * workflows apply the same catalogue the same way. This layer only adapts the
 * macro's stored shape to the executor — resolving snooze presets to a wake time
 * and casting the stored string ids to branded ids — then applies best-effort so
 * one bad action never blocks the reply.
 *
 * `set_attribute` is accepted and stored but no-ops until a general conversation
 * custom-attribute setter exists (see applyAction).
 */
import type { ConversationId, PrincipalId, ConversationTagId, TeamId } from '@quackback/ids'
import type { MacroAction, MacroSnoozePreset } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { tomorrowAt } from '@/lib/shared/utils/date'
import { logger } from '@/lib/server/logger'
import { applyAction, type WorkflowAction } from '@/lib/server/domains/workflows/action.executor'

const log = logger.child({ component: 'macro-actions' })

/** Resolve a snooze preset to a wake time; `until_reply` defers with no timer. */
function snoozeUntil(preset: MacroSnoozePreset): Date | null {
  switch (preset) {
    case 'tomorrow':
      return tomorrowAt(9)
    case 'next_week': {
      const d = tomorrowAt(9)
      d.setDate(d.getDate() + 6)
      return d
    }
    case 'until_reply':
    default:
      return null
  }
}

/** Adapt a stored macro action to an executor action (presets → wake time, string
 *  ids → branded ids). Returns null for a shape the executor doesn't take. */
function toWorkflowAction(action: MacroAction): WorkflowAction | null {
  switch (action.type) {
    case 'assign_agent':
      return { type: 'assign_agent', principalId: action.principalId as PrincipalId }
    case 'assign_team':
      return { type: 'assign_team', teamId: action.teamId as TeamId }
    case 'add_tag':
      return { type: 'add_tag', tagId: action.tagId as ConversationTagId }
    case 'set_priority':
      return { type: 'set_priority', priority: action.priority }
    case 'snooze':
      return { type: 'snooze', untilIso: snoozeUntil(action.preset)?.toISOString() ?? null }
    case 'close':
      return { type: 'close' }
    case 'set_attribute':
      return { type: 'set_attribute', key: action.key, value: action.value }
  }
}

/**
 * Run each action against the conversation. Returns the labels of the actions
 * that were actually applied (deferred/failed ones are excluded), so the caller
 * can tell the agent exactly what happened.
 */
export async function applyMacroActions(
  conversationId: ConversationId,
  actions: MacroAction[],
  actor: Actor
): Promise<string[]> {
  if (actions.length === 0) return []
  const applied: string[] = []
  for (const action of actions) {
    const workflowAction = toWorkflowAction(action)
    if (!workflowAction) continue
    try {
      const label = await applyAction(workflowAction, { conversationId, actor })
      if (label) applied.push(label)
    } catch (err) {
      log.error({ err, action: action.type, conversationId }, 'macro action failed')
    }
  }
  return applied
}

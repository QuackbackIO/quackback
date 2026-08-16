/**
 * Single source of truth for the audit-log page's "AI config" filter group
 * (audit-log-page.tsx). A new assistant.* event only needs to be added here
 * to show up correctly there.
 *
 * Client-safe: `AuditEventType` is imported as a type only, which is erased
 * at compile time, so no server code (db/pino/redis) reaches the client
 * bundle. The `Record<Extract<...>, string>` shape means adding a new
 * `assistant.*` literal to the AuditEventType union without a matching entry
 * here is a compile error — the label map can never drift from the taxonomy.
 */
import type { AuditEventType } from '@/lib/server/audit/log'

export const ASSISTANT_CONFIG_EVENT_LABELS: Record<
  Extract<AuditEventType, `assistant.${string}`>,
  string
> = {
  'assistant.guidance.created': 'Guidance added',
  'assistant.guidance.updated': 'Guidance updated',
  'assistant.guidance.reordered': 'Guidance reordered',
  'assistant.guidance.deleted': 'Guidance deleted',
  // Legacy labels: historical audit rows still reference these events.
  'assistant.custom_action.created': 'Custom action added (legacy)',
  'assistant.custom_action.updated': 'Custom action updated (legacy)',
  'assistant.custom_action.deleted': 'Custom action deleted (legacy)',
  'assistant.connector.created': 'Connector added',
  'assistant.connector.updated': 'Connector updated',
  'assistant.connector.deleted': 'Connector removed',
  'assistant.connector.refreshed': 'Connector tools refreshed',
  'assistant.skill.created': 'Skill added',
  'assistant.skill.updated': 'Skill updated',
  'assistant.skill.deleted': 'Skill deleted',
  'assistant.tool_controls.changed': 'Action settings changed',
  'assistant.surfaces.changed': 'Channel guidance changed',
  'assistant.basics.changed': 'Response style changed',
  'assistant.identity.changed': 'Identity changed',
  'assistant.voice.changed': 'Response style changed',
  'assistant.instructions.changed': 'Writing guidelines changed',
  'assistant.knowledge.changed': 'Knowledge sources changed',
  'assistant.capabilities.changed': 'Copilot capabilities changed',
  'assistant.channels.changed': 'Channel guidance changed',
  'assistant.deployment.changed': 'Automatic replies changed',
}

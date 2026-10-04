import {
  roleToAgent,
  type AssistantAgentKind,
  type AssistantRole,
} from '@/lib/shared/assistant/config'
import { parseConnectorToolName } from '@/lib/shared/assistant/connectors'

/** Home chat threads are private web threads keyed with this prefix. */
export const WORKSPACE_THREAD_PREFIX = 'workspace:'

export function isHomeThreadKey(key: string | null | undefined): boolean {
  return key?.startsWith(WORKSPACE_THREAD_PREFIX) ?? false
}

/**
 * The agent whose configuration a turn runs with. A workspace-assistant turn
 * on a Home thread is Copilot (its knowledge, connectors and skills); on
 * Slack it keeps the workspace agent.
 */
export function agentKindForTurn(
  role: AssistantRole,
  workspaceThreadKey: string | null | undefined
): AssistantAgentKind {
  return roleToAgent(
    role,
    role === 'workspace_assistant' && isHomeThreadKey(workspaceThreadKey) ? 'workspace' : undefined
  )
}

/** The one Home-turn detector: the workspace assistant running as Copilot. */
export function isHomeTurn(ctx: { role: AssistantRole; agentKind: AssistantAgentKind }): boolean {
  return ctx.role === 'workspace_assistant' && ctx.agentKind === 'copilot'
}

export function isConnectorTool(name: string): boolean {
  return parseConnectorToolName(name) !== null
}

/**
 * What Home may offer the model. Reads are allowed except for high blast
 * radius areas; the only write is a settings proposal. Connector writes are
 * never offered, so they can never run from Home.
 */
export function isWorkspaceToolAllowed(name: string, risk: string): boolean {
  if (name === 'widget_install_status') return risk === 'read'
  if (risk !== 'write')
    return !/(delete|remove|install|oauth|billing|member|api_key|domain|sso)/i.test(name)
  return name === 'propose_settings_change'
}

/**
 * Home turns never execute a write on their own, and every connector call
 * waits on the teammate's Allow or Skip.
 */
export function workspaceProposalMode(input: {
  role: AssistantRole
  agentKind: AssistantAgentKind
  name: string
  risk: string
}): 'propose' | null {
  return isHomeTurn(input) && (input.risk === 'write' || isConnectorTool(input.name))
    ? 'propose'
    : null
}

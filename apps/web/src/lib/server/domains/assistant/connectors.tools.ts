/**
 * Turn connected MCP servers into Quinn AssistantToolSpecs.
 *
 * Model-facing names are `mcp_<slug>_<tool>` so catalogues stay unique across
 * connectors. Per-tool allow/ask/deny lives on the connector row; at assembly
 * time those rules are merged into `ctx.toolRules` under the model-facing name.
 */
import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import {
  assistantConnectors,
  db as defaultDb,
  eq,
  type AssistantConnectorRow,
  type ConnectorToolRule,
  type StoredConnectorTool,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantAgentKind as AgentKind } from '@/lib/shared/assistant/config'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { AssistantToolSpec } from './assistant.toolspec'
import { withGateEnvelope } from './assistant.toolspec'
import { invokeConnectorTool } from './connectors.service'
import {
  connectorCallArgs,
  connectorToolInputSchema,
  connectorToolName,
  formatConnectorToolDescription,
  uniqueConnectorToolName,
} from './connectors.names'

export {
  connectorCallArgs,
  connectorToolInputSchema,
  connectorToolName,
  formatConnectorToolDescription,
  sanitizeToolSegment,
  uniqueConnectorToolName,
} from './connectors.names'

const connectorToolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown(),
  note: z.string().optional(),
})

type ConnectorToolOutput = z.infer<typeof connectorToolOutputSchema>

export function buildConnectorToolSpec(
  row: AssistantConnectorRow,
  remoteTool: Pick<StoredConnectorTool, 'name' | 'description' | 'inputSchemaJson'>,
  modelName = connectorToolName(row, remoteTool.name)
): AssistantToolSpec {
  const baseDescription =
    remoteTool.description.trim().length > 0
      ? remoteTool.description
      : `Call ${remoteTool.name} on the ${row.name} connector.`
  const description = formatConnectorToolDescription(baseDescription, remoteTool.inputSchemaJson)

  const definition = toolDefinition({
    name: modelName,
    description,
    inputSchema: connectorToolInputSchema(remoteTool.inputSchemaJson),
    outputSchema: withGateEnvelope(connectorToolOutputSchema),
  })

  return {
    name: modelName,
    label: `${row.name}: ${remoteTool.name}`,
    description,
    promptGuidance: `Use when the ${row.name} connector's "${remoteTool.name}" tool is the right action. ${description}`,
    risk: 'write',
    // Same class as built-in conversation writes: Quinn already holds this
    // autonomously; approving teammates must be able to reply, not only view.
    permissions: [PERMISSIONS.CONVERSATION_REPLY],
    parents: ['conversation', 'ticket'],
    definition,
    execute: async (args: unknown): Promise<ConnectorToolOutput> => {
      const result = await invokeConnectorTool(row, remoteTool.name, connectorCallArgs(args))
      return { ok: result.ok, data: result.data, note: result.note }
    },
    summarize: () => `Run ${row.name} → ${remoteTool.name}`,
  }
}

/** Effective rule for one remote tool (default ask = safe). */
export function connectorToolRule(
  row: AssistantConnectorRow,
  remoteToolName: string
): ConnectorToolRule {
  return row.toolRules?.[remoteToolName] ?? 'ask'
}

/**
 * Specs + model-facing toolRules patch for already-loaded connector rows.
 * Deny omits the tool. Unassigned / disabled rows contribute nothing.
 */
export function assembleConnectorSpecs(
  rows: AssistantConnectorRow[],
  agent: AgentKind
): { specs: AssistantToolSpec[]; toolRulesPatch: Record<string, ConnectorToolRule> } {
  const assigned = rows.filter(
    (row) => row.enabled && (agent === 'agent' ? row.assignments.agent : row.assignments.copilot)
  )

  const specs: AssistantToolSpec[] = []
  const toolRulesPatch: Record<string, ConnectorToolRule> = {}
  const usedNames = new Set<string>()

  for (const row of assigned) {
    for (const tool of row.tools ?? []) {
      const rule = connectorToolRule(row, tool.name)
      if (rule === 'deny') continue
      const modelName = uniqueConnectorToolName(connectorToolName(row, tool.name), usedNames)
      const spec = buildConnectorToolSpec(row, tool, modelName)
      specs.push(spec)
      toolRulesPatch[spec.name] = rule
    }
  }

  return { specs, toolRulesPatch }
}

/**
 * Specs + model-facing toolRules patch for one agent this turn.
 * Caller merges `toolRulesPatch` into the turn's toolRules before assembly.
 */
export async function listConnectorSpecsForAgent(
  agent: AgentKind,
  execDb: Executor = defaultDb
): Promise<{ specs: AssistantToolSpec[]; toolRulesPatch: Record<string, ConnectorToolRule> }> {
  const rows = await execDb
    .select()
    .from(assistantConnectors)
    .where(eq(assistantConnectors.enabled, true))
  return assembleConnectorSpecs(rows, agent)
}

/**
 * Resolve a persisted `mcp_<slug>_<tool>` name for the approve path.
 * Returns null when the connector is gone, disabled, unassigned, or the tool
 * is now denied — same "no longer available" read as a gone built-in.
 */
export async function getConnectorSpecByToolName(
  toolName: string,
  agent: AgentKind,
  execDb: Executor = defaultDb
): Promise<AssistantToolSpec | null> {
  if (!toolName.startsWith('mcp_')) return null
  const { specs } = await listConnectorSpecsForAgent(agent, execDb)
  return specs.find((spec) => spec.name === toolName) ?? null
}

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
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantAgentKind as AgentKind } from '@/lib/shared/assistant/config'
import type { AssistantToolSpec } from './assistant.toolspec'
import { withGateEnvelope } from './assistant.toolspec'
import { invokeConnectorTool } from './connectors.service'

const connectorToolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown(),
  note: z.string().optional(),
})

type ConnectorToolOutput = z.infer<typeof connectorToolOutputSchema>

/** Sanitize an MCP tool name for use inside a Quackback tool id. */
function sanitizeToolSegment(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

/** Stable model-facing tool name for one MCP tool on one connector. */
export function connectorToolName(
  row: Pick<AssistantConnectorRow, 'slug'>,
  remoteName: string
): string {
  return `mcp_${row.slug}_${sanitizeToolSegment(remoteName)}`
}

/**
 * Build a JSON-schema-backed zod input that accepts any object. MCP tools ship
 * arbitrary JSON Schema; we validate lightly (object) and forward args as-is.
 */
function looseObjectInputSchema(description: string) {
  return z.record(z.string(), z.unknown()).describe(description).default({})
}

export function buildConnectorToolSpec(
  row: AssistantConnectorRow,
  remoteTool: { name: string; description: string }
): AssistantToolSpec {
  const toolName = connectorToolName(row, remoteTool.name)
  const description =
    remoteTool.description.trim().length > 0
      ? remoteTool.description
      : `Call ${remoteTool.name} on the ${row.name} connector.`

  const definition = toolDefinition({
    name: toolName,
    description,
    inputSchema: z.object({
      arguments: looseObjectInputSchema('Arguments for the remote MCP tool'),
    }),
    outputSchema: withGateEnvelope(connectorToolOutputSchema),
  })

  return {
    name: toolName,
    label: `${row.name}: ${remoteTool.name}`,
    description,
    promptGuidance: `Use when the ${row.name} connector's "${remoteTool.name}" tool is the right action. ${description}`,
    risk: 'write',
    permissions: [],
    parents: ['conversation', 'ticket'],
    definition,
    execute: async (args: unknown): Promise<ConnectorToolOutput> => {
      const source = (args && typeof args === 'object' ? args : {}) as {
        arguments?: Record<string, unknown>
      }
      const remoteArgs =
        source.arguments && typeof source.arguments === 'object' ? source.arguments : {}
      const result = await invokeConnectorTool(row, remoteTool.name, remoteArgs)
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

  const assigned = rows.filter((row) =>
    agent === 'agent' ? row.assignments.agent : row.assignments.copilot
  )

  const specs: AssistantToolSpec[] = []
  const toolRulesPatch: Record<string, ConnectorToolRule> = {}

  for (const row of assigned) {
    for (const tool of row.tools ?? []) {
      const rule = connectorToolRule(row, tool.name)
      if (rule === 'deny') continue
      const spec = buildConnectorToolSpec(row, tool)
      specs.push(spec)
      toolRulesPatch[spec.name] = rule
    }
  }

  return { specs, toolRulesPatch }
}

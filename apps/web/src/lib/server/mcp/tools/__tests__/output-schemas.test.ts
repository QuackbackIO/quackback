/**
 * Every read-only tool lists an output schema and returns structured content;
 * write tools return short confirmations as text and list none. A new read
 * tool without a schema fails here. Each tool's own tests run its real
 * results through its schema (`output-schema-check.ts`).
 */
import { describe, expect, it } from 'vitest'
import { registerTools } from '@/lib/server/mcp/tools'
import { TOOL_OUTPUT_SCHEMAS } from '../output-schemas'

type Config = { annotations?: { readOnlyHint?: boolean }; outputSchema?: unknown }

function registeredTools(): Map<string, Config> {
  const tools = new Map<string, Config>()
  registerTools(
    { registerTool: (name: string, config: Config) => void tools.set(name, config) } as never,
    {
      principalId: 'principal_test',
      name: 'Test',
      role: 'admin',
      authMethod: 'api-key',
      scopes: [],
    } as never
  )
  return tools
}

describe('tool output schemas', () => {
  const tools = registeredTools()

  it('lists one for every read-only tool, and none for a tool that writes', () => {
    for (const [name, config] of tools) {
      const readOnly = config.annotations?.readOnlyHint === true
      expect({ name, listed: config.outputSchema !== undefined }).toEqual({
        name,
        listed: readOnly,
      })
    }
  })

  it('names only registered tools', () => {
    for (const name of Object.keys(TOOL_OUTPUT_SCHEMAS)) expect(tools.has(name), name).toBe(true)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { registerTools } from '@/lib/server/mcp/tools'

type CollectedTool = {
  name: string
  description: string
  schema: Record<string, { description?: string }>
}

function collectTools(): CollectedTool[] {
  const tools: CollectedTool[] = []
  const fakeServer = {
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      _annotations: unknown,
      _handler: unknown
    ) => {
      const simplified: Record<string, { description?: string }> = {}
      for (const [key, value] of Object.entries(schema)) {
        const desc =
          (value as { _def?: { description?: string } })._def?.description ??
          (value as { description?: string }).description
        simplified[key] = { description: desc }
      }
      tools.push({ name, description, schema: simplified })
    },
  }
  const fakeAuth = {
    principalId: 'principal_test' as Parameters<typeof registerTools>[1]['principalId'],
    userId: 'user_test' as Parameters<typeof registerTools>[1]['userId'],
    name: 'Test',
    email: 'test@example.com',
    role: 'admin' as const,
    authMethod: 'api-key' as const,
    scopes: [],
  }
  registerTools(
    fakeServer as unknown as Parameters<typeof registerTools>[0],
    fakeAuth as unknown as Parameters<typeof registerTools>[1]
  )
  return tools
}

describe('MCP content format metadata', () => {
  const RICH_TOOLS = [
    'create_post',
    'create_changelog',
    'update_changelog',
    'create_article',
    'update_article',
  ]
  const COMMENT_TOOLS = ['add_comment', 'update_comment']

  let tools: CollectedTool[]
  beforeEach(() => {
    tools = collectTools()
  })

  it.each(RICH_TOOLS)('%s: content field mentions markdown and auto-rehost', (toolName) => {
    const tool = tools.find((t) => t.name === toolName)
    expect(tool, `${toolName} not registered`).toBeDefined()
    const description = tool!.schema.content?.description ?? ''
    expect(description.toLowerCase()).toContain('markdown')
    expect(description.toLowerCase()).toContain('auto-rehost')
  })

  it.each(RICH_TOOLS)('%s: tool description contains the content format block', (toolName) => {
    const tool = tools.find((t) => t.name === toolName)!
    expect(tool.description).toContain('Content format:')
    expect(tool.description).toContain('PNG, JPEG, WebP, GIF, AVIF')
  })

  it.each(COMMENT_TOOLS)(
    '%s: content field declares plain text and no markdown support',
    (toolName) => {
      const tool = tools.find((t) => t.name === toolName)!
      const description = tool.schema.content?.description ?? ''
      expect(description.toLowerCase()).toContain('plain text')
      expect(description.toLowerCase()).toContain('not supported')
    }
  )
})

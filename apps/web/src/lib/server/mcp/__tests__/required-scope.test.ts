import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import { registerTools } from '@/lib/server/mcp/tools'
import { registerResources } from '@/lib/server/mcp/server'
import {
  MCP_ARGUMENT_DISPATCHED_TOOLS,
  RESOURCE_SCOPES,
  TOOL_SCOPES,
  requiredScopeForMcpRpc,
  requiredScopesForMcpRpc,
} from '../required-scope'

const TEST_AUTH = {
  principalId: 'principal_test',
  name: 'Test',
  role: 'admin',
  authMethod: 'api-key',
  scopes: [],
} as never

function toolsCall(name: string, args: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
}

describe('requiredScopeForMcpRpc', () => {
  it('maps write tools to their capability scope', () => {
    expect(requiredScopeForMcpRpc(toolsCall('create_post'))).toBe('write:feedback')
    expect(requiredScopeForMcpRpc(toolsCall('create_changelog'))).toBe('write:changelog')
    expect(requiredScopeForMcpRpc(toolsCall('create_article'))).toBe('write:article')
    expect(requiredScopeForMcpRpc(toolsCall('reply_to_conversation'))).toBe('write:chat')
  })

  it('maps search posts to read:feedback and articles to read:article', () => {
    expect(requiredScopeForMcpRpc(toolsCall('search', { query: 'x' }))).toBe('read:feedback')
    expect(requiredScopeForMcpRpc(toolsCall('search', { entity: 'posts' }))).toBe('read:feedback')
    expect(requiredScopeForMcpRpc(toolsCall('search', { entity: 'articles' }))).toBe('read:article')
  })

  it('maps get_details by TypeID prefix', () => {
    expect(requiredScopeForMcpRpc(toolsCall('get_details', { id: generateId('post') }))).toBe(
      'read:feedback'
    )
    expect(requiredScopeForMcpRpc(toolsCall('get_details', { id: generateId('article') }))).toBe(
      'read:article'
    )
    expect(requiredScopeForMcpRpc(toolsCall('get_details', { id: 'not-a-typeid' }))).toBe(
      'read:feedback'
    )
  })

  it('maps help-center resource reads to read:article', () => {
    expect(
      requiredScopeForMcpRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'quackback://help-center/categories' },
      })
    ).toBe('read:article')
  })

  it('ignores initialize and unknown tools', () => {
    expect(requiredScopeForMcpRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })).toBeNull()
    expect(requiredScopeForMcpRpc(toolsCall('not_a_tool'))).toBeNull()
  })

  it('collects every required scope in a JSON-RPC batch', () => {
    expect(
      requiredScopesForMcpRpc([
        toolsCall('search', { query: 'x' }),
        toolsCall('create_article'),
        { jsonrpc: '2.0', id: 3, method: 'initialize' },
      ])
    ).toEqual(['read:feedback', 'write:article'])
  })

  it('maps every registered tool that is not argument-dispatched', () => {
    const names: string[] = []
    registerTools(
      {
        tool: (name: string) => {
          names.push(name)
        },
      } as never,
      TEST_AUTH
    )
    const dispatched = new Set<string>(MCP_ARGUMENT_DISPATCHED_TOOLS)
    const registeredFixed = names.filter((name) => !dispatched.has(name))
    expect(registeredFixed.sort()).toEqual(Object.keys(TOOL_SCOPES).sort())
    for (const name of dispatched) expect(names).toContain(name)
  })

  it('marks a tool read-only exactly when its scope only reads, so writes are always audited', () => {
    // The tool-call audit skips tools annotated read-only. A write tool marked
    // read-only by mistake would change things with no audit row.
    const annotations = new Map<string, { readOnlyHint?: boolean }>()
    registerTools(
      {
        tool: (name: string, _d: string, _s: unknown, a: { readOnlyHint?: boolean }) => {
          annotations.set(name, a)
        },
      } as never,
      TEST_AUTH
    )
    const dispatched = new Set<string>(MCP_ARGUMENT_DISPATCHED_TOOLS)
    for (const [name, a] of annotations) {
      const readOnly = a?.readOnlyHint === true
      if (dispatched.has(name)) {
        expect({ name, readOnly }).toEqual({ name, readOnly: true })
        continue
      }
      const reads = TOOL_SCOPES[name]?.startsWith('read:') ?? false
      expect({ name, readOnly }).toEqual({ name, readOnly: reads })
    }
    expect(annotations.size).toBeGreaterThan(Object.keys(TOOL_SCOPES).length)
  })

  it('maps every registered resource URI', () => {
    const uris: string[] = []
    registerResources(
      {
        resource: (_name: string, uri: string) => {
          uris.push(uri)
        },
      } as never,
      TEST_AUTH
    )
    expect(uris.sort()).toEqual(Object.keys(RESOURCE_SCOPES).sort())
    for (const [uri, scope] of Object.entries(RESOURCE_SCOPES)) {
      expect(
        requiredScopeForMcpRpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/read',
          params: { uri },
        })
      ).toBe(scope)
    }
  })

  it('ignores unknown resource URIs', () => {
    expect(
      requiredScopeForMcpRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'quackback://not-a-resource' },
      })
    ).toBeNull()
  })
})

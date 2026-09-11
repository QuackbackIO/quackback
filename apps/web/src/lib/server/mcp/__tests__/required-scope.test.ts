import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import { requiredScopeForMcpRpc } from '../required-scope'

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
})

/**
 * accept_suggestion merges two posts, so it needs post.merge as well as
 * suggestion.manage, like the merge tool and the admin app (FBA-M-11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { createId } from '@quackback/ids'

const accept = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  acceptMergeSuggestion: accept,
  dismissMergeSuggestion: vi.fn(),
  restoreMergeSuggestion: vi.fn(),
}))

import { registerSuggestionTools } from '../suggestions'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(permissions: string[]): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    registerTool: (name: string, _c: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerSuggestionTools(
    fakeServer as never,
    {
      principalId: 'principal_member',
      name: 'Acme',
      role: 'member',
      permissions: new Set(permissions),
      authMethod: 'oauth',
      scopes: ['write:feedback'],
    } as unknown as McpAuthContext
  )
  return handlers
}

beforeEach(() => accept.mockReset())

describe('accept_suggestion', () => {
  it('refuses a caller with suggestion.manage but not post.merge, and merges nothing', async () => {
    const tools = collect(['suggestion.manage'])
    const result = await tools.get('accept_suggestion')!({ id: createId('post_merge_suggestion') })
    expect(result.isError).toBe(true)
    expect(accept).not.toHaveBeenCalled()
  })

  it('accepts for a caller holding both', async () => {
    const tools = collect(['suggestion.manage', 'post.merge'])
    const result = await tools.get('accept_suggestion')!({ id: createId('post_merge_suggestion') })
    expect(result.isError).not.toBe(true)
    expect(accept).toHaveBeenCalledOnce()
  })
})

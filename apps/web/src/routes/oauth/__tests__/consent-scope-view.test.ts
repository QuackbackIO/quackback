/**
 * The consent screen must surface the full capability catalogue.
 * First-connect reads are defaults; writes stay available as opt-in.
 * Identity scopes stay off the screen; offline_access is a toggle.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCESS_DOMAINS,
  domainAccessLevels,
  MCP_FIRST_CONNECT_SCOPES,
} from '@/lib/shared/api-key-scopes'
import { defaultSelectedScopes } from '@/lib/shared/mcp-consent-scopes'

describe('MCP consent catalogue', () => {
  it('defaults first-connect to three Reads with changelog off', () => {
    const selected = defaultSelectedScopes([...MCP_FIRST_CONNECT_SCOPES])
    expect(ACCESS_DOMAINS).toHaveLength(4)
    expect(domainAccessLevels(selected)).toEqual({
      feedback: 'read',
      changelog: 'off',
      article: 'read',
      chat: 'read',
    })
  })
})

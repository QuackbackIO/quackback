import { describe, it, expect } from 'vitest'
import { ALL_SCOPES } from '../handler'

describe('MCP scopes', () => {
  it('grants chat scopes to API-key (all-scope) callers', () => {
    expect(ALL_SCOPES).toContain('read:chat')
    expect(ALL_SCOPES).toContain('write:chat')
  })
})

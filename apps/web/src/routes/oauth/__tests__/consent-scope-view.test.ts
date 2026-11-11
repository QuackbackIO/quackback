/**
 * The consent screen must surface the full capability catalogue.
 * A plain connect defaults to full access; the person can narrow it.
 * Identity scopes stay off the screen; offline_access is a toggle.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCESS_DOMAINS,
  domainAccessLevels,
  MCP_CHALLENGE_SCOPES,
} from '@/lib/shared/api-key-scopes'
import { consentPreset, defaultSelectedScopes } from '@/lib/shared/mcp-consent-scopes'

describe('MCP consent catalogue', () => {
  it('defaults a connect that follows the 401 challenge to full access', () => {
    const selected = defaultSelectedScopes([...MCP_CHALLENGE_SCOPES])
    expect(ACCESS_DOMAINS).toHaveLength(5)
    expect(consentPreset(domainAccessLevels(selected))).toBe('full')
  })
})

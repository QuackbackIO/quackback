import { describe, expect, it } from 'vitest'
import { analyticsDistinctId, analyticsWorkspaceKey } from '../analytics-identity'

describe('analyticsDistinctId', () => {
  it('is the email, lowercased and trimmed, so every app that knows the person agrees', () => {
    expect(analyticsDistinctId(' Ana@Example.COM ')).toBe('ana@example.com')
  })

  it('is null without an email', () => {
    expect(analyticsDistinctId(undefined)).toBeNull()
    expect(analyticsDistinctId('')).toBeNull()
  })
})

describe('analyticsWorkspaceKey', () => {
  it('derives a stable opaque key from the workspace key, never the key itself', async () => {
    const key = await analyticsWorkspaceKey('inst_abc', 'settings_1')
    expect(key).toMatch(/^ws_[0-9a-f]{24}$/)
    expect(key).not.toContain('inst_abc')
    expect(await analyticsWorkspaceKey('inst_abc', 'settings_other')).toBe(key)
  })

  it('pins the derivation, which other apps reproduce byte for byte', async () => {
    // sha256('quackback-analytics-workspace:inst_abc'), first 24 hex chars.
    expect(await analyticsWorkspaceKey('inst_abc', null)).toBe('ws_30472172391e32087b26a741')
  })

  it('falls back to the settings row id on a single-workspace install', async () => {
    expect(await analyticsWorkspaceKey(null, 'settings_1')).toBe(
      await analyticsWorkspaceKey('settings_1', null)
    )
    expect(await analyticsWorkspaceKey(null, null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { trialReturnPath } from '../trial'

describe('trialReturnPath', () => {
  it('returns to the admin page that raised the prompt', () => {
    expect(trialReturnPath('/admin/automation/workflows')).toBe('/admin/automation/workflows')
    expect(trialReturnPath('/admin/settings/developers?tab=webhooks')).toBe(
      '/admin/settings/developers?tab=webhooks'
    )
    expect(trialReturnPath('/admin')).toBe('/admin')
  })

  it('falls back to Plan & billing when nothing was given', () => {
    expect(trialReturnPath(undefined)).toBe('/admin/settings/billing')
    expect(trialReturnPath('')).toBe('/admin/settings/billing')
  })

  it('never redirects off the admin area', () => {
    for (const bad of [
      'https://evil.example/admin',
      '//evil.example/admin',
      '/administrator',
      '/portal',
      '/admin\\@evil.example',
      '/admin/x\r\nSet-Cookie: a=b',
      '/admin/settings billing',
    ]) {
      expect(trialReturnPath(bad)).toBe('/admin/settings/billing')
    }
  })
})

import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '../permissions'
import { authTabsFor, resolveAuthTab } from '../authentication-tabs'

const AUTH = PERMISSIONS.AUTH_MANAGE

describe('Access & Security tabs', () => {
  it('offers Portal access only with settings.manage, which its portal config read needs', () => {
    expect(authTabsFor([AUTH])).toEqual(['sign-in'])
    expect(authTabsFor([AUTH, PERMISSIONS.SETTINGS_MANAGE])).toEqual(['portal-access', 'sign-in'])
  })

  it('offers Audit log only with audit.view, which the audit feed needs', () => {
    expect(authTabsFor([AUTH, PERMISSIONS.AUDIT_VIEW])).toEqual(['sign-in', 'audit-log'])
  })

  it('opens the tab asked for when the viewer has it, otherwise their first', () => {
    const signInOnly = authTabsFor([AUTH])
    expect(resolveAuthTab(undefined, signInOnly)).toBe('sign-in')
    expect(resolveAuthTab('portal-access', signInOnly)).toBe('sign-in')
    expect(resolveAuthTab('audit-log', signInOnly)).toBe('sign-in')
    const all = authTabsFor([AUTH, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_VIEW])
    expect(resolveAuthTab(undefined, all)).toBe('portal-access')
    expect(resolveAuthTab('audit-log', all)).toBe('audit-log')
  })
})

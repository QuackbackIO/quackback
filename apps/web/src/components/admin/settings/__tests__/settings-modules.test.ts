import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { describe, expect, it } from 'vitest'
import {
  buildSettingsModules,
  settingsModuleLandingPath,
  settingsModuleRedirectPath,
  settingsModulesFor,
} from '../settings-modules'

describe('buildSettingsModules', () => {
  it('always includes Feedback & Roadmaps pages', () => {
    const feedback = buildSettingsModules().find((m) => m.id === 'feedback')!
    expect(feedback.pages.map((p) => p.label)).toEqual(['Boards', 'Statuses', 'Tags', 'Moderation'])
  })

  it('omits Support when both support flags are off', () => {
    expect(buildSettingsModules({ helpCenter: true }).map((m) => m.id)).not.toContain('support')
  })

  it('lists Channels first when the inbox is on, without nested channel pages', () => {
    const support = buildSettingsModules({ supportInbox: true }).find((m) => m.id === 'support')!
    expect(support.pages.map((p) => p.label)).toEqual([
      'Channels',
      'Macros',
      'Office hours',
      'SLA policies',
    ])
    expect(support.pages.map((p) => p.to)).not.toContain('/admin/settings/channels/messenger')
  })

  it('appends ticket pages after inbox pages', () => {
    const support = buildSettingsModules({ supportInbox: true, supportTickets: true }).find(
      (m) => m.id === 'support'
    )!
    expect(support.pages.map((p) => p.label)).toEqual([
      'Channels',
      'Macros',
      'Office hours',
      'SLA policies',
      'Ticket types',
      'Ticket statuses',
    ])
  })

  it('lists Email and GitHub when only supportTickets is on', () => {
    const support = buildSettingsModules({ supportTickets: true }).find((m) => m.id === 'support')!
    expect(support.pages.map((p) => p.label)).toEqual([
      'Email',
      'GitHub',
      'Macros',
      'Office hours',
      'SLA policies',
      'Ticket types',
      'Ticket statuses',
    ])
  })
})

describe('settingsModuleLandingPath', () => {
  it('sends multi-page modules to their first page, never a hub', () => {
    const modules = buildSettingsModules({ supportInbox: true })
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'feedback')!)).toBe(
      '/admin/settings/boards'
    )
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'support')!)).toBe(
      '/admin/settings/channels'
    )
  })

  it('lands Support on Email when only tickets are on', () => {
    const modules = buildSettingsModules({ supportTickets: true })
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'support')!)).toBe(
      '/admin/settings/channels/email'
    )
  })

  it('sends single-page modules to the page itself', () => {
    const modules = buildSettingsModules({ helpCenter: true })
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'helpCenter')!)).toBe(
      '/admin/settings/help-center'
    )
  })
})

describe('module pages and permissions', () => {
  const flags = { supportInbox: true, supportTickets: true, helpCenter: true }
  const manager = new Set<PermissionKey>(SYSTEM_ROLE_PERMISSIONS.manager)
  const pagesOf = (modules: ReturnType<typeof buildSettingsModules>, id: string) =>
    modules.find((m) => m.id === id)?.pages.map((p) => p.to)

  it('keeps only the pages a viewer can open and drops empty modules', () => {
    const modules = settingsModulesFor(buildSettingsModules(flags), manager)
    const everyone = buildSettingsModules(flags)
    expect(manager.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    expect(pagesOf(modules, 'support')).not.toContain('/admin/settings/channels')
    expect(pagesOf(modules, 'support')?.length).toBeLessThan(pagesOf(everyone, 'support')!.length)
    expect(settingsModulesFor(buildSettingsModules(flags), new Set<PermissionKey>()).length).toBe(0)
  })

  it('sends Support to a page the viewer can open, not the first one', () => {
    const to = settingsModuleRedirectPath('support', flags, manager)
    const page = buildSettingsModules(flags)
      .find((m) => m.id === 'support')!
      .pages.find((p) => p.to === to)
    expect(page).toBeDefined()
    expect(manager.has(page!.permission)).toBe(true)
    expect(to).not.toBe('/admin/settings/channels')
  })

  it('sends a hub with nothing openable, or switched off, to the settings root', () => {
    expect(settingsModuleRedirectPath('support', flags, new Set())).toBe('/admin/settings')
    expect(settingsModuleRedirectPath('support', {}, new Set(SYSTEM_ROLE_PERMISSIONS.owner))).toBe(
      '/admin/settings'
    )
  })

  it('sends an owner to the first page', () => {
    expect(
      settingsModuleRedirectPath('support', flags, new Set(SYSTEM_ROLE_PERMISSIONS.owner))
    ).toBe('/admin/settings/channels')
  })
})

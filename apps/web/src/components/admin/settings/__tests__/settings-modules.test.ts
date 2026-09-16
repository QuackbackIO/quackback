import { describe, expect, it } from 'vitest'
import {
  buildSettingsModules,
  settingsModuleForPath,
  settingsModuleLandingPath,
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
      'Office Hours',
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
      'Office Hours',
      'SLA policies',
      'Ticket types',
      'Ticket statuses & stages',
    ])
  })

  it('lists Email and GitHub when only supportTickets is on', () => {
    const support = buildSettingsModules({ supportTickets: true }).find((m) => m.id === 'support')!
    expect(support.pages.map((p) => p.label)).toEqual([
      'Email',
      'GitHub',
      'Macros',
      'Office Hours',
      'SLA policies',
      'Ticket types',
      'Ticket statuses & stages',
    ])
  })
})

describe('settingsModuleLandingPath', () => {
  it('sends multi-page modules to their hub card', () => {
    const modules = buildSettingsModules({ supportInbox: true })
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'feedback')!)).toBe(
      '/admin/settings/feedback'
    )
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'support')!)).toBe(
      '/admin/settings/support'
    )
  })

  it('sends single-page modules to the page itself', () => {
    const modules = buildSettingsModules({ helpCenter: true })
    expect(settingsModuleLandingPath(modules.find((m) => m.id === 'helpCenter')!)).toBe(
      '/admin/settings/help-center'
    )
  })
})

describe('settingsModuleForPath', () => {
  const modules = buildSettingsModules({
    supportInbox: true,
    helpCenter: true,
    statusPage: true,
  })

  it('matches the feedback hub to Feedback & Roadmaps', () => {
    expect(settingsModuleForPath('/admin/settings/feedback', modules)?.id).toBe('feedback')
  })

  it('matches a nested board page to Feedback & Roadmaps', () => {
    expect(settingsModuleForPath('/admin/settings/boards/general-feedback', modules)?.id).toBe(
      'feedback'
    )
  })

  it('matches a channel child page to Support', () => {
    expect(settingsModuleForPath('/admin/settings/channels/email', modules)?.id).toBe('support')
  })

  it('does not treat Statuses as the Status module', () => {
    expect(settingsModuleForPath('/admin/settings/statuses', modules)?.id).toBe('feedback')
    expect(settingsModuleForPath('/admin/settings/status', modules)?.id).toBe('status')
  })
})

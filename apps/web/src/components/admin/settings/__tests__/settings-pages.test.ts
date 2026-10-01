import { describe, expect, it } from 'vitest'
import { buildNavSections } from '../settings-nav'
import { buildSettingsModules } from '../settings-modules'
import {
  AUTOMATION_PAGES,
  SETTINGS_PAGES,
  settingsPageLabel,
  type SettingsPagePath,
} from '../settings-pages'
import { AUTOMATION_PAGE_ICONS, SETTINGS_PAGE_ICONS } from '../settings-page-icons'

const ALL_FLAGS = {
  supportInbox: true,
  supportTickets: true,
  helpCenter: true,
  changelog: true,
  status: true,
} as never

describe('settings page registry', () => {
  it('holds the final label for each page', () => {
    const labels = Object.fromEntries(
      Object.entries(SETTINGS_PAGES).map(([path, page]) => [path, page.label])
    )
    expect(labels).toMatchObject({
      '/admin/settings/feedback': 'Feedback & Roadmaps',
      '/admin/settings/support': 'Support',
      '/admin/settings/boards': 'Boards',
      '/admin/settings/office-hours': 'Office hours',
      '/admin/settings/sla': 'SLA policies',
      '/admin/settings/ticket-statuses': 'Ticket statuses',
      '/admin/settings/people': 'Users',
      '/admin/settings/conversation-data': 'Conversations',
      '/admin/settings/billing': 'Plan & billing',
      '/admin/settings/widget/install': 'Install',
      '/admin/settings/security/authentication': 'Access & Security',
      '/admin/settings/imports': 'Imports & exports',
      '/admin/settings/labs': 'Labs',
    })
  })

  it('gives every page an icon', () => {
    for (const path of Object.keys(SETTINGS_PAGES))
      expect(SETTINGS_PAGE_ICONS[path as SettingsPagePath], path).toBeTruthy()
  })

  it('maps the five AI & Automation paths to message descriptors', () => {
    expect(Object.keys(AUTOMATION_PAGES).sort()).toEqual([
      '/admin/settings/agent',
      '/admin/settings/connectors',
      '/admin/settings/copilot',
      '/admin/settings/skills',
      '/admin/settings/workflows',
    ])
    expect(AUTOMATION_PAGES['/admin/settings/agent']).toMatchObject({
      id: 'automation.nav.agent',
      defaultMessage: 'Agent',
    })
  })

  it('throws for a path that is not registered', () => {
    expect(() => settingsPageLabel('/admin/settings/nope' as never)).toThrow()
  })

  it('names the renamed pages in the nav', () => {
    const navItems = buildNavSections(ALL_FLAGS, true, true)
      .flatMap((section) => section.items)
      .filter((item) => !('kids' in item))
    expect(navItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(['Users', 'Conversations', 'Plan & billing'])
    )
  })

  it('is the source of every module page label', () => {
    for (const module of buildSettingsModules(ALL_FLAGS)) {
      for (const page of module.pages) {
        const entry = (SETTINGS_PAGES as Record<string, { label: string }>)[page.to]
        expect(entry, page.to).toBeDefined()
        expect(page.label).toBe(entry!.label)
      }
    }
  })

  it('is the source of every AI & Automation nav label and icon', () => {
    const section = buildNavSections(ALL_FLAGS, true, true).find(
      (candidate) => candidate.label === 'AI & Automation'
    )!
    expect(section.items).toHaveLength(5)
    for (const item of section.items as Array<{ label: string; to: string; icon: unknown }>) {
      const path = item.to as keyof typeof AUTOMATION_PAGES
      expect(item.label).toBe(AUTOMATION_PAGES[path].defaultMessage)
      expect(item.icon).toBe(AUTOMATION_PAGE_ICONS[path])
    }
  })
})

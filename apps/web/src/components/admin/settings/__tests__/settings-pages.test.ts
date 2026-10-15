import { describe, expect, it } from 'vitest'
import { buildNavSections } from '../settings-nav-sections'
import { buildSettingsModules } from '../settings-modules'
import {
  AI_PAGES,
  SETTINGS_PAGES,
  settingsPageLabel,
  type SettingsPagePath,
} from '../settings-pages'
import { AI_PAGE_ICONS, SETTINGS_PAGE_ICONS } from '../settings-page-icons'

const ALL_FLAGS = {
  supportInbox: true,
  supportTickets: true,
  helpCenter: true,
  changelog: true,
  statusPage: true,
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
      '/admin/settings/hours-sla': 'Hours & SLAs',

      '/admin/settings/tickets': 'Tickets',
      '/admin/settings/people': 'Users',
      '/admin/settings/fields': 'Fields & tags',
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

  it('maps the AI pages to one consistent set of message descriptors', () => {
    expect(AI_PAGES['/admin/settings/ai/customers']).toMatchObject({ defaultMessage: 'Customers' })
    expect(AI_PAGES['/admin/settings/ai/guidance']).toMatchObject({ defaultMessage: 'Guidance' })
  })

  it('throws for a path that is not registered', () => {
    expect(() => settingsPageLabel('/admin/settings/nope' as never)).toThrow()
  })

  it('names the renamed pages in the nav', () => {
    const navItems = buildNavSections(ALL_FLAGS, true, true)
      .flatMap((section) => section.items)
      .filter((item) => !('pages' in item))
    expect(navItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(['Users', 'Plan & billing'])
    )
  })

  it('is the source of every module page label', () => {
    for (const module of buildSettingsModules(ALL_FLAGS)) {
      for (const page of module.pages) {
        const entry = (
          { ...SETTINGS_PAGES, ...AI_PAGES } as Record<
            string,
            { label?: string; defaultMessage?: string }
          >
        )[page.to]
        expect(entry, page.to).toBeDefined()
        expect(page.label).toBe(entry!.label ?? entry!.defaultMessage)
      }
    }
  })

  it('gives each AI module page an icon and its registry label', () => {
    const module = buildSettingsModules(ALL_FLAGS).find((m) => m.id === 'ai')!
    expect(module.pages).toHaveLength(5)
    for (const page of module.pages) {
      const path = page.to as keyof typeof AI_PAGES
      expect(page.label).toBe(AI_PAGES[path].defaultMessage)
      expect(AI_PAGE_ICONS[path]).toBeTruthy()
    }
  })
})

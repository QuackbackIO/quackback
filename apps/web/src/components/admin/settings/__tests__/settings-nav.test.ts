import { describe, it, expect } from 'vitest'
import {
  buildNavSections,
  isNavModule,
  moduleCrumb,
  moduleOfPage,
  pathIsUnder,
} from '../settings-nav-sections'

/** Flatten a section's entries to labels, expanding product accordions. */
function itemLabels(sections: ReturnType<typeof buildNavSections>, section: string): string[] {
  const s = sections.find((x) => x.label === section)!
  return s.items.map((i) => i.label)
}

function modulePages(
  sections: ReturnType<typeof buildNavSections>,
  section: string,
  group: string
): { label: string; to?: string }[] {
  const s = sections.find((x) => x.label === section)!
  const g = s.items.find((i) => i.label === group)
  if (!g || !isNavModule(g)) return []
  return g.pages.map((k) => ({ label: k.label, to: 'to' in k ? k.to : undefined }))
}

function entryLabels(
  entry: ReturnType<typeof buildNavSections>[number]['items'][number]
): string[] {
  if (!isNavModule(entry)) return [entry.label]
  return [entry.label, ...entry.pages.flatMap(entryLabels)]
}

function allLabels(sections: ReturnType<typeof buildNavSections>): string[] {
  return sections.flatMap((s) => s.items.flatMap(entryLabels))
}

describe('buildNavSections', () => {
  it('always renders the four sections in order, regardless of flags', () => {
    for (const flags of [
      undefined,
      {},
      { helpCenter: true, supportInbox: true, supportTickets: true },
      { supportInbox: true },
    ]) {
      const sections = buildNavSections(flags)
      expect(sections.map((s) => s.label)).toEqual([
        'Modules',
        'AI & Automation',
        'Workspace',
        'Data',
      ])
    }
  })

  it('lists the AI & Automation pages between Modules and Workspace', () => {
    const sections = buildNavSections({ supportInbox: true })
    expect(
      sections
        .find((s) => s.label === 'AI & Automation')!
        .items.map((i) => [i.label, 'to' in i ? i.to : undefined])
    ).toEqual([
      ['Agent', '/admin/settings/agent'],
      ['Copilot', '/admin/settings/copilot'],
      ['Skills', '/admin/settings/skills'],
      ['Connectors', '/admin/settings/connectors'],
      ['Workflows', '/admin/settings/workflows'],
    ])
    expect(allLabels(sections)).not.toContain('Performance')
    expect(allLabels(sections)).not.toContain('Assistant')
  })

  it('leaves Workflows out while the Support inbox is off, and keeps the other rows', () => {
    const labels = itemLabels(buildNavSections({ supportInbox: false }), 'AI & Automation')
    expect(labels).toEqual(['Agent', 'Copilot', 'Skills', 'Connectors'])
  })

  it('Modules lists Feedback & Roadmaps as a group of its own pages, with no hub row', () => {
    const sections = buildNavSections()
    expect(itemLabels(sections, 'Modules')).toContain('Feedback & Roadmaps')
    expect(modulePages(sections, 'Modules', 'Feedback & Roadmaps')).toEqual([
      { label: 'Boards', to: '/admin/settings/boards' },
      { label: 'Statuses', to: '/admin/settings/statuses' },
      { label: 'Tags', to: '/admin/settings/tags' },
      { label: 'Moderation', to: '/admin/settings/moderation' },
    ])
    const group = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Feedback & Roadmaps')!
    expect(isNavModule(group)).toBe(true)
    expect(allLabels(sections)).not.toContain('Public Statuses')
    expect(itemLabels(buildNavSections({ feedback: false }), 'Modules')).toContain(
      'Feedback & Roadmaps'
    )
  })

  it('has no Support row when both support flags are off', () => {
    const sections = buildNavSections({ helpCenter: true })
    expect(itemLabels(sections, 'Modules')).not.toContain('Support')
  })

  it('Support groups its pages when the inbox is on', () => {
    const sections = buildNavSections({ supportInbox: true })
    expect(modulePages(sections, 'Modules', 'Support')).toEqual([
      { label: 'Channels', to: '/admin/settings/channels' },
      { label: 'Macros', to: '/admin/settings/macros' },
      { label: 'Office hours', to: '/admin/settings/office-hours' },
      { label: 'SLA policies', to: '/admin/settings/sla' },
    ])
    expect(itemLabels(sections, 'Workspace')).not.toContain('Emails')
    expect(allLabels(sections)).not.toContain('Messenger')
    expect(allLabels(sections)).not.toContain('GitHub')
  })

  it('Support lists the ticket pages when tickets are on', () => {
    const sections = buildNavSections({ supportInbox: true, supportTickets: true })
    expect(modulePages(sections, 'Modules', 'Support').map((k) => k.label)).toEqual([
      'Channels',
      'Macros',
      'Office hours',
      'SLA policies',
      'Ticket types',
      'Ticket statuses',
    ])
  })

  it('Support opens on Email and GitHub when only supportTickets is on', () => {
    const sections = buildNavSections({ supportTickets: true })
    expect(modulePages(sections, 'Modules', 'Support').slice(0, 2)).toEqual([
      { label: 'Email', to: '/admin/settings/channels/email' },
      { label: 'GitHub', to: '/admin/settings/channels/github' },
    ])
    expect(allLabels(sections)).not.toContain('Channels')
  })

  it('Help Center is a flat link that appears only with the helpCenter flag', () => {
    expect(itemLabels(buildNavSections({ helpCenter: false }), 'Modules')).not.toContain(
      'Help Center'
    )
    const sections = buildNavSections({ helpCenter: true })
    expect(modulePages(sections, 'Modules', 'Help Center')).toEqual([])
    const item = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Help Center')!
    expect(!isNavModule(item) && item.to).toBe('/admin/settings/help-center')
  })

  it('Changelog is a flat link that appears only when the product is enabled', () => {
    expect(itemLabels(buildNavSections({ changelog: false }), 'Modules')).not.toContain('Changelog')
    const sections = buildNavSections()
    expect(modulePages(sections, 'Modules', 'Changelog')).toEqual([])
    const item = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Changelog')!
    expect(!isNavModule(item) && item.to).toBe('/admin/settings/changelog')
  })

  it('Status is a flat link that appears only with the status flag', () => {
    expect(itemLabels(buildNavSections(), 'Modules')).not.toContain('Status')
    const sections = buildNavSections({ statusPage: true })
    expect(modulePages(sections, 'Modules', 'Status')).toEqual([])
    const item = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Status')!
    expect(!isNavModule(item) && item.to).toBe('/admin/settings/status')
  })

  it('makes modules only of the products that have several pages', () => {
    const sections = buildNavSections({
      helpCenter: true,
      supportInbox: true,
      supportTickets: true,
      statusPage: true,
    })
    const modules = sections
      .find((s) => s.label === 'Modules')!
      .items.filter((item) => isNavModule(item))
      .map((item) => item.label)
    expect(modules).toEqual(['Feedback & Roadmaps', 'Support'])
  })

  it('Workspace contains the administration pages in order (flags off)', () => {
    const sections = buildNavSections()
    expect(itemLabels(sections, 'Workspace')).toEqual([
      'General',
      'Notifications',
      'Portal',
      'Widget',
      'Members & Teams',
      'Access & Security',
      'Developers',
      'Labs',
      'Integrations',
    ])
  })

  it('General points at the new general URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const general = s.items.find((i) => i.label === 'General')!
    expect(!isNavModule(general) && general.to).toBe('/admin/settings/general')
  })

  it('Portal points at the portal URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const portal = s.items.find((i) => i.label === 'Portal')!
    expect(!isNavModule(portal) && portal.to).toBe('/admin/settings/portal')
  })

  it('has no standalone Audit log item (merged into Access & Security)', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    expect(allLabels(sections)).not.toContain('Audit log')
  })

  it('Workspace does not list Emails once Channels owns that page', () => {
    const sections = buildNavSections({ supportInbox: true })
    expect(itemLabels(sections, 'Workspace')).not.toContain('Emails')
  })

  it('Members & Teams points at the merged members URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const members = s.items.find((i) => i.label === 'Members & Teams')!
    expect(!isNavModule(members) && members.to).toBe('/admin/settings/members')
  })

  it('Access & Security points at the authentication URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const security = s.items.find((i) => i.label === 'Access & Security')!
    expect(!isNavModule(security) && security.to).toBe('/admin/settings/security/authentication')
  })

  it('Data contains Users and Imports & exports (always), Conversations under support', () => {
    expect(itemLabels(buildNavSections(), 'Data')).toEqual([
      'Users',
      'Companies',
      'Imports & exports',
    ])
    const sections = buildNavSections({ supportInbox: true })
    expect(itemLabels(sections, 'Data')).toEqual([
      'Users',
      'Companies',
      'Conversations',
      'Imports & exports',
    ])
    expect(itemLabels(buildNavSections({ supportTickets: true }), 'Data')).toEqual([
      'Users',
      'Companies',
      'Conversations',
      'Imports & exports',
    ])
    const s = sections.find((x) => x.label === 'Data')!
    const conv = s.items.find((i) => i.label === 'Conversations')!
    expect(!isNavModule(conv) && conv.to).toBe('/admin/settings/conversation-data')
    const imports = s.items.find((i) => i.label === 'Imports & exports')!
    expect(!isNavModule(imports) && imports.to).toBe('/admin/settings/imports')
  })

  it('never lists Teams as a nav item (teams live inside Members & Teams)', () => {
    const sections = buildNavSections({
      helpCenter: true,
      supportInbox: true,
      supportTickets: true,
    })
    expect(allLabels(sections)).not.toContain('Teams')
  })

  it('does NOT list standalone API Keys, Webhooks, or MCP entries anywhere', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    const labels = allLabels(sections)
    expect(labels).not.toContain('API Keys')
    expect(labels).not.toContain('Webhooks')
    expect(labels).not.toContain('MCP Server')
  })

  it('retired section names are gone (Administration, Customization, Customers, Support section)', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    const sectionLabels = sections.map((s) => s.label)
    for (const retired of ['Administration', 'Customization', 'Customers', 'Support', 'General']) {
      expect(sectionLabels).not.toContain(retired)
    }
  })
})

describe('moduleOfPage', () => {
  const pagesOf = (module: ReturnType<typeof moduleOfPage>) => module?.pages.map((p) => p.to)

  it('finds the module a page belongs to, with all of its pages', () => {
    const sections = buildNavSections({ supportInbox: true })
    for (const page of ['/admin/settings/boards', '/admin/settings/moderation']) {
      const module = moduleOfPage(sections, page)
      expect(module?.label).toBe('Feedback & Roadmaps')
      expect(pagesOf(module)).toEqual([
        '/admin/settings/boards',
        '/admin/settings/statuses',
        '/admin/settings/tags',
        '/admin/settings/moderation',
      ])
    }
    expect(moduleOfPage(sections, '/admin/settings/sla')?.label).toBe('Support')
  })

  it('has no module for a page under a module page, which is a child page', () => {
    const sections = buildNavSections({ supportInbox: true })
    expect(moduleOfPage(sections, '/admin/settings/boards/feature-requests')).toBeUndefined()
    expect(moduleOfPage(sections, '/admin/settings/channels/email')).toBeUndefined()
  })

  it('puts Email and GitHub in Support while there is no Channels page', () => {
    const sections = buildNavSections({ supportTickets: true })
    expect(moduleOfPage(sections, '/admin/settings/channels/email')?.label).toBe('Support')
  })

  it('has no module for a single-page product or a workspace page', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    expect(moduleOfPage(sections, '/admin/settings/help-center')).toBeUndefined()
    expect(moduleOfPage(sections, '/admin/settings/changelog')).toBeUndefined()
    expect(moduleOfPage(sections, '/admin/settings/general')).toBeUndefined()
    expect(moduleOfPage(sections, undefined)).toBeUndefined()
  })
})

describe('pathIsUnder', () => {
  it('matches the page itself and the pages under it, not a page that only shares a prefix', () => {
    expect(pathIsUnder('/admin/settings/boards', '/admin/settings/boards')).toBe(true)
    expect(pathIsUnder('/admin/settings/boards/feature-requests', '/admin/settings/boards')).toBe(
      true
    )
    expect(pathIsUnder('/admin/settings/statuses', '/admin/settings/status')).toBe(false)
    expect(pathIsUnder('/admin/settings/status', '/admin/settings/statuses')).toBe(false)
  })
})

describe('moduleCrumb', () => {
  it("links to the module and takes the module's label from the registry", () => {
    expect(moduleCrumb('/admin/settings/feedback')).toEqual({
      label: 'Feedback & Roadmaps',
      to: '/admin/settings/feedback',
    })
    expect(moduleCrumb('/admin/settings/support')).toEqual({
      label: 'Support',
      to: '/admin/settings/support',
    })
  })
})

import { describe, it, expect } from 'vitest'
import { buildNavSections, isNavGroup } from '../settings-nav'

/** Flatten a section's entries to labels, expanding product accordions. */
function itemLabels(sections: ReturnType<typeof buildNavSections>, section: string): string[] {
  const s = sections.find((x) => x.label === section)!
  return s.items.map((i) => i.label)
}

function groupKids(
  sections: ReturnType<typeof buildNavSections>,
  section: string,
  group: string
): { label: string; to?: string }[] {
  const s = sections.find((x) => x.label === section)!
  const g = s.items.find((i) => i.label === group)
  if (!g || !isNavGroup(g)) return []
  return g.kids.map((k) => ({ label: k.label, to: 'to' in k ? k.to : undefined }))
}

function entryLabels(
  entry: ReturnType<typeof buildNavSections>[number]['items'][number]
): string[] {
  if (!isNavGroup(entry)) return [entry.label]
  return [entry.label, ...entry.kids.flatMap(entryLabels)]
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
    expect(groupKids(sections, 'Modules', 'Feedback & Roadmaps')).toEqual([
      { label: 'Boards', to: '/admin/settings/boards' },
      { label: 'Statuses', to: '/admin/settings/statuses' },
      { label: 'Tags', to: '/admin/settings/tags' },
      { label: 'Moderation', to: '/admin/settings/moderation' },
    ])
    const group = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Feedback & Roadmaps')!
    expect(isNavGroup(group)).toBe(true)
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
    expect(groupKids(sections, 'Modules', 'Support')).toEqual([
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
    expect(groupKids(sections, 'Modules', 'Support').map((k) => k.label)).toEqual([
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
    expect(groupKids(sections, 'Modules', 'Support').slice(0, 2)).toEqual([
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
    expect(groupKids(sections, 'Modules', 'Help Center')).toEqual([])
    const item = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Help Center')!
    expect(!isNavGroup(item) && item.to).toBe('/admin/settings/help-center')
  })

  it('Changelog is a flat link that appears only when the product is enabled', () => {
    expect(itemLabels(buildNavSections({ changelog: false }), 'Modules')).not.toContain('Changelog')
    const sections = buildNavSections()
    expect(groupKids(sections, 'Modules', 'Changelog')).toEqual([])
    const item = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Changelog')!
    expect(!isNavGroup(item) && item.to).toBe('/admin/settings/changelog')
  })

  it('Status is a flat link that appears only with the status flag', () => {
    expect(itemLabels(buildNavSections(), 'Modules')).not.toContain('Status')
    const sections = buildNavSections({ statusPage: true })
    expect(groupKids(sections, 'Modules', 'Status')).toEqual([])
    const item = sections
      .find((s) => s.label === 'Modules')!
      .items.find((i) => i.label === 'Status')!
    expect(!isNavGroup(item) && item.to).toBe('/admin/settings/status')
  })

  it('nests only the modules that have several pages', () => {
    const sections = buildNavSections({
      helpCenter: true,
      supportInbox: true,
      supportTickets: true,
      statusPage: true,
    })
    const groups = sections
      .find((s) => s.label === 'Modules')!
      .items.filter((item) => isNavGroup(item))
      .map((item) => item.label)
    expect(groups).toEqual(['Feedback & Roadmaps', 'Support'])
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
    expect(!isNavGroup(general) && general.to).toBe('/admin/settings/general')
  })

  it('Portal points at the portal URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const portal = s.items.find((i) => i.label === 'Portal')!
    expect(!isNavGroup(portal) && portal.to).toBe('/admin/settings/portal')
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
    expect(!isNavGroup(members) && members.to).toBe('/admin/settings/members')
  })

  it('Access & Security points at the authentication URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const security = s.items.find((i) => i.label === 'Access & Security')!
    expect(!isNavGroup(security) && security.to).toBe('/admin/settings/security/authentication')
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
    expect(!isNavGroup(conv) && conv.to).toBe('/admin/settings/conversation-data')
    const imports = s.items.find((i) => i.label === 'Imports & exports')!
    expect(!isNavGroup(imports) && imports.to).toBe('/admin/settings/imports')
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

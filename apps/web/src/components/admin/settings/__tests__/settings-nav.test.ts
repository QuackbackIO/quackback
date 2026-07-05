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
): { label: string; to: string }[] {
  const s = sections.find((x) => x.label === section)!
  const g = s.items.find((i) => i.label === group)
  if (!g || !isNavGroup(g)) return []
  return g.kids.map((k) => ({ label: k.label, to: k.to }))
}

function allLabels(sections: ReturnType<typeof buildNavSections>): string[] {
  return sections.flatMap((s) =>
    s.items.flatMap((i) => (isNavGroup(i) ? [i.label, ...i.kids.map((k) => k.label)] : [i.label]))
  )
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
        'Products',
        'AI & Automation',
        'Workspace',
        'Data',
      ])
    }
  })

  it('Products always contains the Feedback accordion with its four pages', () => {
    const sections = buildNavSections()
    expect(itemLabels(sections, 'Products')).toContain('Feedback')
    expect(groupKids(sections, 'Products', 'Feedback').map((k) => k.label)).toEqual([
      'Boards',
      'Statuses',
      'Tags',
      'Moderation',
    ])
  })

  it('has no Support accordion when both support flags are off', () => {
    const sections = buildNavSections({ helpCenter: true })
    expect(itemLabels(sections, 'Products')).not.toContain('Support')
  })

  it('Support shows Messenger, Macros, Office Hours and SLA policies under supportInbox', () => {
    const sections = buildNavSections({ supportInbox: true })
    expect(groupKids(sections, 'Products', 'Support').map((k) => k.label)).toEqual([
      'Messenger',
      'Macros',
      'Office Hours',
      'SLA policies',
    ])
  })

  it('Support shows ticket pages under supportTickets, after the inbox pages', () => {
    const sections = buildNavSections({ supportInbox: true, supportTickets: true })
    expect(groupKids(sections, 'Products', 'Support').map((k) => k.label)).toEqual([
      'Messenger',
      'Macros',
      'Office Hours',
      'SLA policies',
      'Ticket types',
      'Ticket statuses & stages',
    ])
  })

  it('Support shows only ticket pages when just supportTickets is on', () => {
    const sections = buildNavSections({ supportTickets: true })
    expect(groupKids(sections, 'Products', 'Support').map((k) => k.label)).toEqual([
      'Ticket types',
      'Ticket statuses & stages',
    ])
  })

  it('Messenger points at the conversations URL (relabel, URL kept)', () => {
    const sections = buildNavSections({ supportInbox: true })
    const messenger = groupKids(sections, 'Products', 'Support').find(
      (k) => k.label === 'Messenger'
    )!
    expect(messenger.to).toBe('/admin/settings/conversations')
  })

  it('Help Center accordion appears only with the helpCenter flag', () => {
    expect(itemLabels(buildNavSections(), 'Products')).not.toContain('Help Center')
    const sections = buildNavSections({ helpCenter: true })
    expect(groupKids(sections, 'Products', 'Help Center')).toEqual([
      { label: 'Settings', to: '/admin/settings/help-center' },
    ])
  })

  it('SLA policies points at the sla URL', () => {
    const sections = buildNavSections({ supportInbox: true })
    const sla = groupKids(sections, 'Products', 'Support').find((k) => k.label === 'SLA policies')!
    expect(sla.to).toBe('/admin/settings/sla')
  })

  it('AI & Automation contains Assistant, Workflows and Sandbox', () => {
    const sections = buildNavSections()
    expect(itemLabels(sections, 'AI & Automation')).toEqual(['Assistant', 'Workflows', 'Sandbox'])
  })

  it('Workflows points at the standalone workflows URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'AI & Automation')!
    const workflows = s.items.find((i) => i.label === 'Workflows')!
    expect(!isNavGroup(workflows) && workflows.to).toBe('/admin/settings/workflows')
  })

  it('Workspace contains the administration pages in order (flags off)', () => {
    const sections = buildNavSections()
    expect(itemLabels(sections, 'Workspace')).toEqual([
      'General',
      'Branding',
      'Portal',
      'Widget',
      'Members & Teams',
      'Access & Security',
      'Developers',
      'Integrations',
      'Labs',
    ])
  })

  it('General points at the new general URL', () => {
    const sections = buildNavSections()
    const s = sections.find((x) => x.label === 'Workspace')!
    const general = s.items.find((i) => i.label === 'General')!
    expect(!isNavGroup(general) && general.to).toBe('/admin/settings/general')
  })

  it('has no standalone Audit log item (merged into Access & Security)', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    expect(allLabels(sections)).not.toContain('Audit log')
  })

  it('Workspace gains Emails (the email channel page) under supportInbox', () => {
    const sections = buildNavSections({ supportInbox: true })
    const workspace = itemLabels(sections, 'Workspace')
    expect(workspace).toContain('Emails')
    // Emails sits between Access & Security and Developers.
    expect(workspace.indexOf('Emails')).toBe(workspace.indexOf('Access & Security') + 1)
    const s = sections.find((x) => x.label === 'Workspace')!
    const emails = s.items.find((i) => i.label === 'Emails')!
    expect(!isNavGroup(emails) && emails.to).toBe('/admin/settings/channels')
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

  it('Data contains People', () => {
    const sections = buildNavSections()
    expect(itemLabels(sections, 'Data')).toEqual(['People'])
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

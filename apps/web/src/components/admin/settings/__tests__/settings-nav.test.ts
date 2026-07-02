import { describe, it, expect } from 'vitest'
import { buildNavSections } from '../settings-nav'

describe('buildNavSections', () => {
  it('has no Support section when no flags provided', () => {
    const sections = buildNavSections()
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Support')
  })

  it('has no Support section when both helpCenter and supportInbox are false', () => {
    const sections = buildNavSections({ helpCenter: false, supportInbox: false })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Support')
  })

  it('includes a Support section when helpCenter flag is true', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toContain('Support')
  })

  it('includes a Support section when supportInbox flag is true', () => {
    const sections = buildNavSections({ supportInbox: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toContain('Support')
  })

  it('places Support between Feedback and Customers', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    const labels = sections.map((s) => s.label)
    const feedbackIdx = labels.indexOf('Feedback')
    const supportIdx = labels.indexOf('Support')
    const customersIdx = labels.indexOf('Customers')
    expect(supportIdx).toBeGreaterThan(feedbackIdx)
    expect(supportIdx).toBeLessThan(customersIdx)
  })

  it('Support bundles Conversations then Help Center in that order', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    const support = sections.find((s) => s.label === 'Support')!
    expect(support.items.map((i) => i.label)).toEqual(['Conversations', 'Help Center'])
    expect(support.items.find((i) => i.label === 'Conversations')!.to).toBe(
      '/admin/settings/conversations'
    )
    expect(support.items.find((i) => i.label === 'Help Center')!.to).toBe(
      '/admin/settings/help-center'
    )
  })

  it('Support contains only Help Center when supportInbox is off', () => {
    const sections = buildNavSections({ helpCenter: true })
    const support = sections.find((s) => s.label === 'Support')!
    expect(support.items.map((i) => i.label)).toEqual(['Help Center'])
  })

  it('Support contains only Conversations when helpCenter is off', () => {
    const sections = buildNavSections({ supportInbox: true })
    const support = sections.find((s) => s.label === 'Support')!
    expect(support.items.map((i) => i.label)).toEqual(['Conversations'])
  })

  it('does not place Conversations under Customization', () => {
    const sections = buildNavSections({ supportInbox: true })
    const customization = sections.find((s) => s.label === 'Customization')!
    const conversations = customization.items.find((i) => i.label === 'Conversations')
    expect(conversations).toBeUndefined()
  })

  it('places Widget and Branding under Customization', () => {
    const sections = buildNavSections()
    const customization = sections.find((s) => s.label === 'Customization')!
    const branding = customization.items.find((i) => i.label === 'Branding')
    const widget = customization.items.find((i) => i.label === 'Widget')
    expect(branding).toBeDefined()
    expect(branding!.to).toBe('/admin/settings/branding')
    expect(widget).toBeDefined()
    expect(widget!.to).toBe('/admin/settings/widget')
  })

  it('does not place Widget under Feedback', () => {
    const sections = buildNavSections()
    const feedback = sections.find((s) => s.label === 'Feedback')!
    const widgetItem = feedback.items.find((i) => i.label === 'Widget')
    expect(widgetItem).toBeUndefined()
  })

  it('has no Portal section (merged into other groups)', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Portal')
  })

  it('has no separate Security section (rolled into Administration)', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Security')
  })

  it('has no separate General section (replaced by Administration)', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('General')
  })

  it('has no separate Developers section (folded into Administration)', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Developers')
  })

  it('has the expected section order with helpCenter and supportInbox on', () => {
    const sections = buildNavSections({ helpCenter: true, supportInbox: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual([
      'Administration',
      'Customization',
      'Feedback',
      'Support',
      'AI & Automation',
      'Customers',
    ])
  })

  it('has the expected section order without helpCenter', () => {
    const sections = buildNavSections()
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual([
      'Administration',
      'Customization',
      'Feedback',
      'AI & Automation',
      'Customers',
    ])
  })

  it('Administration contains Members, Integrations, Security, Audit log, Developers, Labs in that order', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    expect(administration.items.map((i) => i.label)).toEqual([
      'Members',
      'Integrations',
      'Security',
      'Audit log',
      'Developers',
      'Labs',
    ])
  })

  it('Audit log points at the audit-log URL', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    const auditLog = administration.items.find((i) => i.label === 'Audit log')!
    expect(auditLog.to).toBe('/admin/settings/security/audit-log')
  })

  it('Members points at the existing team URL', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    const members = administration.items.find((i) => i.label === 'Members')!
    expect(members.to).toBe('/admin/settings/team')
  })

  it('Security points at the authentication URL', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    const security = administration.items.find((i) => i.label === 'Security')!
    expect(security.to).toBe('/admin/settings/security/authentication')
  })

  it('Integrations points at the integrations URL', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    const integrations = administration.items.find((i) => i.label === 'Integrations')!
    expect(integrations.to).toBe('/admin/settings/integrations')
  })

  it('Developers points at the developers URL', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    const developers = administration.items.find((i) => i.label === 'Developers')!
    expect(developers.to).toBe('/admin/settings/developers')
  })

  it('Labs points at the labs URL', () => {
    const sections = buildNavSections()
    const administration = sections.find((s) => s.label === 'Administration')!
    const labs = administration.items.find((i) => i.label === 'Labs')!
    expect(labs.to).toBe('/admin/settings/labs')
  })

  it('does not have a standalone Access item in the Feedback section', () => {
    const sections = buildNavSections()
    const feedback = sections.find((s) => s.label === 'Feedback')!
    const accessItem = feedback.items.find((i) => i.label === 'Access')
    expect(accessItem).toBeUndefined()
  })

  it('does NOT list standalone API Keys, Webhooks, or MCP entries anywhere', () => {
    const sections = buildNavSections({ helpCenter: true })
    const allItems = sections.flatMap((s) => s.items.map((i) => i.label))
    expect(allItems).not.toContain('API Keys')
    expect(allItems).not.toContain('Webhooks')
    expect(allItems).not.toContain('MCP Server')
  })

  it('does NOT duplicate Security/Authentication under Customers', () => {
    const sections = buildNavSections()
    const customers = sections.find((s) => s.label === 'Customers')!
    const dupes = customers.items.filter(
      (i) => i.label === 'Authentication' || i.label === 'Security'
    )
    expect(dupes).toHaveLength(0)
    expect(customers.items.map((i) => i.label)).toEqual(['People'])
  })
})

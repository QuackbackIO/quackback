import { describe, it, expect } from 'vitest'
import { buildNavSections } from '../settings-nav'

describe('buildNavSections', () => {
  it('returns sections without Help Center when no flags provided', () => {
    const sections = buildNavSections()
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Help Center')
  })

  it('returns sections without Help Center when helpCenter flag is false', () => {
    const sections = buildNavSections({ helpCenter: false })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Help Center')
  })

  it('includes Help Center section when helpCenter flag is true', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toContain('Help Center')
  })

  it('places Help Center between Feedback and Customers', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    const feedbackIdx = labels.indexOf('Feedback')
    const helpCenterIdx = labels.indexOf('Help Center')
    const customersIdx = labels.indexOf('Customers')
    expect(helpCenterIdx).toBeGreaterThan(feedbackIdx)
    expect(helpCenterIdx).toBeLessThan(customersIdx)
  })

  it('has Help Center item', () => {
    const sections = buildNavSections({ helpCenter: true })
    const helpCenter = sections.find((s) => s.label === 'Help Center')!
    expect(helpCenter.items).toHaveLength(1)
    expect(helpCenter.items[0].label).toBe('Help Center')
    expect(helpCenter.items[0].to).toBe('/admin/settings/help-center')
  })

  it('places Widget and Branding under Customization', () => {
    const sections = buildNavSections()
    const customization = sections.find((s) => s.label === 'Customization')!
    const branding = customization.items.find((i) => i.label === 'Branding')
    const widget = customization.items.find((i) => i.label === 'Widget')
    expect(branding).toBeDefined()
    expect(branding!.to).toBe('/admin/settings/branding')
    expect(widget).toBeDefined()
    expect(widget!.to).toBe('/admin/settings/portal-widget')
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

  it('has the expected section order with helpCenter flag on', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual([
      'Administration',
      'Customization',
      'Feedback',
      'Help Center',
      'Customers',
    ])
  })

  it('has the expected section order without helpCenter', () => {
    const sections = buildNavSections()
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual(['Administration', 'Customization', 'Feedback', 'Customers'])
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

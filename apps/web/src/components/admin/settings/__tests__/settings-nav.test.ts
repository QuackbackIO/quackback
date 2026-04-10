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

  it('places Help Center between Portal and Users', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    const portalIdx = labels.indexOf('Portal')
    const helpCenterIdx = labels.indexOf('Help Center')
    const usersIdx = labels.indexOf('Users')
    expect(helpCenterIdx).toBeGreaterThan(portalIdx)
    expect(helpCenterIdx).toBeLessThan(usersIdx)
  })

  it('has Help Center item', () => {
    const sections = buildNavSections({ helpCenter: true })
    const helpCenter = sections.find((s) => s.label === 'Help Center')!
    expect(helpCenter.items).toHaveLength(1)
    expect(helpCenter.items[0].label).toBe('Help Center')
    expect(helpCenter.items[0].to).toBe('/admin/settings/help-center')
  })

  it('does not include Widget under Feedback', () => {
    const sections = buildNavSections()
    const feedback = sections.find((s) => s.label === 'Feedback')!
    const widgetItem = feedback.items.find((i) => i.label === 'Widget')
    expect(widgetItem).toBeUndefined()
  })

  it('includes Widget under Portal', () => {
    const sections = buildNavSections()
    const portal = sections.find((s) => s.label === 'Portal')!
    const widgetItem = portal.items.find((i) => i.label === 'Widget')
    expect(widgetItem).toBeDefined()
    expect(widgetItem!.to).toBe('/admin/settings/portal-widget')
  })

  it('includes Portal > General with correct route', () => {
    const sections = buildNavSections()
    const portal = sections.find((s) => s.label === 'Portal')!
    const general = portal.items.find((i) => i.label === 'General')
    expect(general).toBeDefined()
    expect(general!.to).toBe('/admin/settings/portal')
  })

  it('has the expected section order', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual([
      'Workspace',
      'Appearance',
      'Feedback',
      'Portal',
      'Help Center',
      'Users',
      'Developers',
      'Advanced',
    ])
  })

  it('has the expected section order without helpCenter', () => {
    const sections = buildNavSections()
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual([
      'Workspace',
      'Appearance',
      'Feedback',
      'Portal',
      'Users',
      'Developers',
      'Advanced',
    ])
  })
})

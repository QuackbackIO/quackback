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

  it('places Help Center between Feedback and End Users', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    const feedbackIdx = labels.indexOf('Feedback')
    const helpCenterIdx = labels.indexOf('Help Center')
    const endUsersIdx = labels.indexOf('End Users')
    expect(helpCenterIdx).toBeGreaterThan(feedbackIdx)
    expect(helpCenterIdx).toBeLessThan(endUsersIdx)
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

  it('places Experimental under Developers', () => {
    const sections = buildNavSections()
    const developers = sections.find((s) => s.label === 'Developers')!
    const experimental = developers.items.find((i) => i.label === 'Experimental')
    expect(experimental).toBeDefined()
    expect(experimental!.to).toBe('/admin/settings/experimental')
  })

  it('has no Portal section (merged into other groups)', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).not.toContain('Portal')
  })

  it('has the expected section order with helpCenter flag on', () => {
    const sections = buildNavSections({ helpCenter: true })
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual([
      'General',
      'Customization',
      'Feedback',
      'Help Center',
      'End Users',
      'Developers',
    ])
  })

  it('has the expected section order without helpCenter', () => {
    const sections = buildNavSections()
    const labels = sections.map((s) => s.label)
    expect(labels).toEqual(['General', 'Customization', 'Feedback', 'End Users', 'Developers'])
  })
})

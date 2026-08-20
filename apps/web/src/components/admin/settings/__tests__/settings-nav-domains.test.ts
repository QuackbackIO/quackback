import { describe, expect, it } from 'vitest'
import { buildNavSections, isNavGroup } from '../settings-nav'

const FLAGS = { supportInbox: true, supportTickets: true }

describe('settings nav with cloud identity off', () => {
  it('is identical to the nav with the Domains row removed', () => {
    const withoutDomains = buildNavSections(FLAGS, false, false)
    const withDomains = buildNavSections(FLAGS, false, true)

    expect(withoutDomains).toEqual(
      withDomains.map((section) =>
        section.label === 'Workspace'
          ? {
              ...section,
              items: section.items.filter(
                (item) => isNavGroup(item) || item.to !== '/admin/settings/domains'
              ),
            }
          : section
      )
    )
  })

  it('defaults to no Domains row', () => {
    expect(buildNavSections(FLAGS)).toEqual(buildNavSections(FLAGS, false, false))
  })

  it('adds exactly one Domains row next to General when cloud is on', () => {
    const workspace = buildNavSections(FLAGS, false, true).find((s) => s.label === 'Workspace')!
    const added = workspace.items.filter((item) => !isNavGroup(item) && item.to.includes('domains'))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ label: 'Domains', to: '/admin/settings/domains' })
    const generalIndex = workspace.items.findIndex(
      (item) => 'label' in item && item.label === 'General'
    )
    const domainsIndex = workspace.items.findIndex(
      (item) => 'label' in item && item.label === 'Domains'
    )
    expect(domainsIndex).toBe(generalIndex + 1)
  })
})

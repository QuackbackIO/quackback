import { describe, expect, it } from 'vitest'
import {
  buildNavSections,
  isNavModule,
  moduleCrumb,
  moduleOfPage,
  pathIsUnder,
} from '../settings-nav-sections'

const entries = (flags: Parameters<typeof buildNavSections>[0] = {}) =>
  buildNavSections(flags).flatMap((s) => s.items)
const pages = (label: string, flags: Parameters<typeof buildNavSections>[0]) => {
  const entry = entries(flags).find((i) => i.label === label)
  return entry && isNavModule(entry) ? entry.pages : []
}

describe('settings information architecture', () => {
  it('keeps three stable sections and removes the technology-based section', () => {
    for (const flags of [undefined, {}, { supportInbox: true }, { supportTickets: true }]) {
      expect(buildNavSections(flags).map((s) => s.label)).toEqual(['Modules', 'Workspace', 'Data'])
    }
  })

  it('keeps each product in one nav row with its own pages as tabs', () => {
    const modules = buildNavSections({ supportInbox: true, supportTickets: true }).find(
      (s) => s.label === 'Modules'
    )!.items
    expect(modules.filter(isNavModule).map((m) => m.label)).toEqual([
      'Feedback & Roadmaps',
      'Support',
      'Quackback AI',
    ])
    expect(
      pages('Support', { supportInbox: true, supportTickets: true }).map((p) => p.label)
    ).toEqual([
      'Channels',
      'Who answers',
      'Workflows',
      'Macros',
      'Hours & SLAs',
      'Tickets',
      'Fields & tags',
    ])
    expect(pages('Quackback AI', {}).map((p) => p.label)).toEqual([
      'Customers',
      'Teammates',
      'Knowledge',
      'Guidance',
      'Actions',
    ])
  })

  it('keeps channel pages at the same depth when only tickets are on', () => {
    for (const flags of [{ supportInbox: true }, { supportTickets: true }]) {
      expect(pages('Support', flags)[0].to).toBe('/admin/settings/channels')
      expect(pages('Support', flags).map((p) => p.to)).not.toContain(
        '/admin/settings/channels/email'
      )
      expect(
        moduleOfPage(buildNavSections(flags), '/admin/settings/channels/email')
      ).toBeUndefined()
    }
    expect(pages('Support', { supportTickets: true }).map((p) => p.label)).toEqual([
      'Channels',
      'Workflows',
      'Macros',
      'Hours & SLAs',
      'Tickets',
      'Fields & tags',
    ])
  })

  it('hides Support when both support products are off', () => {
    expect(entries().map((i) => i.label)).not.toContain('Support')
  })

  it('keeps existing feedback and single-page product homes', () => {
    expect(pages('Feedback & Roadmaps', {}).map((p) => p.label)).toEqual([
      'Boards',
      'Statuses',
      'Tags',
      'Moderation',
    ])
    expect(
      entries({ helpCenter: true, changelog: true, statusPage: true }).map((i) => i.label)
    ).toEqual(expect.arrayContaining(['Help Center', 'Changelog', 'Status']))
    expect(
      moduleOfPage(buildNavSections({ helpCenter: true }), '/admin/settings/help-center')
    ).toBeUndefined()
  })

  it('gathers inbound assistants, keys and webhooks into one workspace row', () => {
    expect(pages('Agents & API', {}).map((p) => p.label)).toEqual([
      'Assistants',
      'API keys',
      'Webhooks',
    ])
    const workspace = buildNavSections().find((s) => s.label === 'Workspace')!.items
    expect(workspace.filter((i) => !isNavModule(i)).map((i) => i.label)).not.toContain('Webhooks')
  })

  it('keeps conversation fields in Support and the remaining data pages separate', () => {
    const data = buildNavSections({ supportInbox: true }).find((s) => s.label === 'Data')!.items
    expect(data.map((i) => i.label)).toEqual(['Users', 'Companies', 'Imports & exports'])
    expect(pages('Support', { supportInbox: true }).map((p) => p.to)).toContain(
      '/admin/settings/fields'
    )
  })

  it('respects operator and billing availability on the workspace rows', () => {
    const labels = (billing: boolean, operator: boolean) =>
      buildNavSections({}, billing, operator)
        .find((s) => s.label === 'Workspace')!
        .items.map((i) => i.label)
    expect(labels(false, false)).not.toContain('Domains')
    expect(labels(false, false)).not.toContain('Plan & billing')
    expect(labels(true, true)).toEqual(expect.arrayContaining(['Domains', 'Plan & billing']))
  })

  it('looks up the owning module without prefix collisions', () => {
    const sections = buildNavSections({ supportInbox: true })
    expect(moduleOfPage(sections, '/admin/settings/hours-sla')?.label).toBe('Support')
    expect(moduleOfPage(sections, '/admin/settings/ai/actions')?.label).toBe('Quackback AI')
    expect(moduleOfPage(sections, '/admin/settings/agents/keys')?.label).toBe('Agents & API')
    expect(moduleOfPage(sections, '/admin/settings/boards/example')).toBeUndefined()
    expect(moduleOfPage(sections, undefined)).toBeUndefined()
    expect(pathIsUnder('/admin/settings/statuses', '/admin/settings/status')).toBe(false)
    expect(pathIsUnder('/admin/settings/boards/example', '/admin/settings/boards')).toBe(true)
  })

  it('keeps module breadcrumbs linked to their stable landing URLs', () => {
    expect(moduleCrumb('/admin/settings/support')).toEqual({
      label: 'Support',
      to: '/admin/settings/support',
    })
    expect(moduleCrumb('/admin/settings/feedback')).toEqual({
      label: 'Feedback & Roadmaps',
      to: '/admin/settings/feedback',
    })
  })
})

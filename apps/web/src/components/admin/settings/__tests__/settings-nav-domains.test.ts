import { describe, expect, it } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { DOMAINS_PAGE_PERMISSIONS } from '@/lib/shared/domains-permissions'
import {
  buildNavSections,
  isNavModule,
  navSectionsFor,
} from '../settings-nav-sections'

const FLAGS = { supportInbox: true, supportTickets: true }

const workspaceLabels = (permissions: PermissionKey[]) =>
  navSectionsFor(buildNavSections(FLAGS), new Set(permissions))
    .find((s) => s.label === 'Workspace')
    ?.items.map((item) => item.label) ?? []

describe('settings nav Domains row', () => {
  it('is listed on every install, once, next to General', () => {
    const workspace = buildNavSections(FLAGS).find((s) => s.label === 'Workspace')!
    const domains = workspace.items.filter(
      (item) => !isNavModule(item) && item.to === '/admin/settings/domains'
    )
    expect(domains).toEqual([
      {
        label: 'Domains',
        to: '/admin/settings/domains',
        anyOf: DOMAINS_PAGE_PERMISSIONS,
        overview: { owner: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN },
      },
    ])
    const labels = workspace.items.map((item) => item.label)
    expect(labels.indexOf('Domains')).toBe(labels.indexOf('General') + 1)
  })

  it('opens to a holder of any permission that owns a kind of domain', () => {
    expect(DOMAINS_PAGE_PERMISSIONS).toEqual([
      PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
      PERMISSIONS.AUTH_MANAGE,
    ])
    for (const permission of DOMAINS_PAGE_PERMISSIONS) {
      expect(workspaceLabels([permission]), permission).toContain('Domains')
    }
  })

  it('is hidden from a viewer who holds none of them', () => {
    expect(
      workspaceLabels([PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.HELP_CENTER_MANAGE])
    ).not.toContain('Domains')
  })
})

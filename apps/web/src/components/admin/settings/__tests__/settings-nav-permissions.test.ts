/**
 * Each workspace and data page in the settings nav checks a permission when
 * it opens. The nav offers a page only to a viewer who holds it, so a role
 * that may see the members list is not shown General, Portal, Widget or
 * Developers only to land on Access denied.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { buildNavSections, navSectionsFor } from '../settings-nav'

type Sections = ReturnType<typeof buildNavSections>

const labels = (sections: Sections, section: string) =>
  sections.find((s) => s.label === section)?.items.map((item) => item.label) ?? null

describe('navSectionsFor', () => {
  it('shows a member.view role only the workspace pages it can open', () => {
    const sections = navSectionsFor(
      buildNavSections({}, false, false),
      new Set<PermissionKey>([PERMISSIONS.MEMBER_VIEW])
    )

    expect(labels(sections, 'Workspace')).toEqual(['Notifications', 'Members & Teams'])
    // No data page is open to it, so the section goes.
    expect(labels(sections, 'Data')).toBeNull()
  })

  it('gates each page on the permission it checks', () => {
    const only = (permission: PermissionKey) =>
      navSectionsFor(buildNavSections({ supportInbox: true }, true, true), new Set([permission]))

    expect(labels(only(PERMISSIONS.SETTINGS_MANAGE), 'Workspace')).toEqual([
      'General',
      'Notifications',
      'Widget',
      'Labs',
    ])
    expect(labels(only(PERMISSIONS.SETTINGS_MANAGE), 'Data')).toEqual(['Imports & exports'])
    expect(labels(only(PERMISSIONS.SETTINGS_BRANDING), 'Workspace')).toEqual([
      'Notifications',
      'Portal',
    ])
    expect(labels(only(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN), 'Workspace')).toEqual([
      'Domains',
      'Notifications',
    ])
    expect(labels(only(PERMISSIONS.AUTH_MANAGE), 'Workspace')).toEqual([
      'Notifications',
      'Access & Security',
    ])
    expect(labels(only(PERMISSIONS.API_KEY_MANAGE), 'Workspace')).toEqual([
      'Notifications',
      'Developers',
    ])
    expect(labels(only(PERMISSIONS.INTEGRATION_VIEW), 'Workspace')).toEqual([
      'Notifications',
      'Integrations',
    ])
    expect(labels(only(PERMISSIONS.BILLING_MANAGE), 'Workspace')).toEqual([
      'Notifications',
      'Plan & billing',
    ])
    expect(labels(only(PERMISSIONS.USER_ATTRIBUTE_VIEW), 'Data')).toEqual(['People'])
    expect(labels(only(PERMISSIONS.COMPANY_VIEW), 'Data')).toEqual(['Companies'])
    expect(labels(only(PERMISSIONS.CONVERSATION_MANAGE), 'Data')).toEqual(['Conversations'])
  })

  it('shows an owner every page', () => {
    const sections = buildNavSections({ supportInbox: true }, true, true)
    expect(navSectionsFor(sections, new Set(SYSTEM_ROLE_PERMISSIONS.owner))).toEqual(sections)
  })

  it('leaves Plan & billing out for an admin, who cannot manage billing', () => {
    const sections = navSectionsFor(
      buildNavSections({}, true, false),
      new Set(SYSTEM_ROLE_PERMISSIONS.admin)
    )
    expect(labels(sections, 'Workspace')).not.toContain('Plan & billing')
    expect(labels(sections, 'Workspace')).toContain('General')
  })

  it('leaves the product modules as they are', () => {
    const sections = buildNavSections({ supportInbox: true, helpCenter: true }, false, false)
    expect(labels(navSectionsFor(sections, new Set()), 'Modules')).toEqual(
      labels(sections, 'Modules')
    )
  })
})

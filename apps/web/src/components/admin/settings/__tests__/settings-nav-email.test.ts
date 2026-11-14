import { describe, expect, it } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { buildNavSections, navSectionsFor } from '../settings-nav-sections'
import { buildAskDestinations } from '@/lib/shared/ask-destinations'

/** Feedback only: no Support, Help Center, Changelog or Status. */
const FEEDBACK_ONLY = {
  supportInbox: false,
  supportTickets: false,
  helpCenter: false,
  changelog: false,
  statusPage: false,
}

const workspaceLabels = (permissions: PermissionKey[], flags: object = FEEDBACK_ONLY) =>
  navSectionsFor(buildNavSections(flags), new Set(permissions))
    .find((s) => s.label === 'Workspace')
    ?.items.map((item) => item.label) ?? []

describe('settings nav Email row', () => {
  it('sits under Workspace after Domains, whatever products are on', () => {
    const labels = workspaceLabels([
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    ])
    expect(labels).toContain('Email')
    expect(labels.indexOf('Email')).toBe(labels.indexOf('Domains') + 1)
  })

  it('is offered to whoever may change how the workspace sends', () => {
    expect(workspaceLabels([PERMISSIONS.SETTINGS_MANAGE])).toContain('Email')
  })

  it('is not offered on the support permission alone', () => {
    expect(workspaceLabels([PERMISSIONS.CHANNEL_ACCOUNT_MANAGE])).not.toContain('Email')
  })

  it('is a destination in the palette with words people search for', () => {
    const email = buildAskDestinations({
      permissions: new Set([PERMISSIONS.SETTINGS_MANAGE]),
      featureFlags: FEEDBACK_ONLY,
    }).find((d) => d.href === '/admin/settings/email')
    expect(email?.keywords).toEqual(expect.arrayContaining(['sender', 'from address']))
  })

  it('never offers two palette destinations under the same name', () => {
    const labels = buildAskDestinations({
      permissions: new Set([PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE]),
      featureFlags: { ...FEEDBACK_ONLY, supportInbox: true },
    }).map((d) => d.defaultMessage)
    expect(labels.filter((label) => label === 'Email')).toHaveLength(1)
    expect(labels).toContain('Support email')
    const repeated = labels.filter((label, i) => labels.indexOf(label) !== i)
    expect(repeated).toEqual([])
  })
})

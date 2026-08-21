/**
 * The settings nav is the only client-visible surface the billing module
 * touches, so it is where "default off is today's behaviour" has to hold
 * visually as well as functionally.
 *
 * The rest of that guarantee is asserted in
 * `lib/server/domains/billing/__tests__/default-off.test.ts`; the two files
 * are split only because lint forbids `lib/` importing from `components/`.
 */
import { describe, expect, it } from 'vitest'
import { buildNavSections, isNavGroup } from '../settings-nav'

const FLAGS = { supportInbox: true, supportTickets: true }

describe('settings nav with billing unconfigured', () => {
  it('is identical to the nav with the Billing row removed', () => {
    // Whole structures, not "does it contain Billing": a reordering or a
    // dropped item would be just as much a regression, and a `toContain`
    // check would see neither.
    const withoutBilling = buildNavSections(FLAGS, false)
    const withBilling = buildNavSections(FLAGS, true)

    expect(withoutBilling).toEqual(
      withBilling.map((section) =>
        section.label === 'Workspace'
          ? {
              ...section,
              items: section.items.filter(
                (item) => isNavGroup(item) || item.to !== '/admin/settings/billing'
              ),
            }
          : section
      )
    )
  })

  it('defaults to the unconfigured nav when the flag is not passed', () => {
    // A caller that forgets the argument must get today's nav, not a link to
    // a page this deployment cannot serve.
    expect(buildNavSections(FLAGS)).toEqual(buildNavSections(FLAGS, false))
  })

  it('adds exactly one row, in the Workspace section, when billing is on', () => {
    const workspace = buildNavSections(FLAGS, true).find((s) => s.label === 'Workspace')!
    const added = workspace.items.filter((item) => !isNavGroup(item) && item.to.includes('billing'))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ label: 'Plan & billing', to: '/admin/settings/billing' })

    // And no other section gained anything.
    const before = buildNavSections(FLAGS, false)
    const after = buildNavSections(FLAGS, true)
    expect(after.map((s) => s.items.length)).toEqual(
      before.map((s) => (s.label === 'Workspace' ? s.items.length + 1 : s.items.length))
    )
  })
})

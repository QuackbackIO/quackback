/**
 * The admin consistency guard: source-scanning rules over routes/admin and
 * components/admin that keep pages on the shared primitives. Each rule has an
 * allowlist of files that do not comply yet (admin-consistency.allowlist.ts).
 * A rule fails on an offender that is not listed and on a listed entry that no
 * longer offends, so allowlists only shrink. The matchers themselves are
 * tested in admin-consistency-rules.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { AI_PAGES, SETTINGS_PAGES } from '../settings/settings-pages'
import { buildNavSections, isNavModule } from '../settings/settings-nav-sections'
import { ALLOWLIST } from './admin-consistency.allowlist'
import { RULE_NAMES, scanAdminFiles, type RuleName } from './admin-consistency.rules'

// Module landing URLs redirect to a permitted tab; they do not render a page shell.
const landingPaths = new Set(
  buildNavSections({ supportInbox: true, supportTickets: true })
    .flatMap((section) => section.items)
    .filter(isNavModule)
    .map((module) => module.id)
)
const REGISTRY_PATHS = [...Object.keys(SETTINGS_PAGES), ...Object.keys(AI_PAGES)].filter(
  (path) => !landingPaths.has(path as never)
)
const offenders = scanAdminFiles(REGISTRY_PATHS)

const FIX: Record<RuleName, string> = {
  'page-shell': 'use SettingsPage instead of PageHeader or a hand-written <h1',
  'page-width': 'drop the max-w-* class; pick width="form" or "wide" on SettingsPage',
  'registry-pages': 'render <SettingsPage page="<path>"> for this page',
  'create-labels': 'use NewButton or sentence case ("New entry", "Create key")',
  'no-dashes': 'use a comma, colon or two sentences instead of an em or en dash',
  'tab-icons': 'page-section tabs are text only',
  'toggle-rows': 'render the switch through SettingRow',
  palette: 'use semantic tokens (success, warning, destructive, muted) instead of palette colours',
}

describe.each(RULE_NAMES)('admin consistency: %s', (rule) => {
  const allowed = new Set(ALLOWLIST[rule])
  const found = new Set(offenders[rule])

  it('has no offenders outside the allowlist', () => {
    const unlisted = [...found].filter((entry) => !allowed.has(entry)).sort()
    expect(unlisted, `${rule}: ${FIX[rule]}`).toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const stale = [...allowed].filter((entry) => !found.has(entry)).sort()
    expect(stale, `${rule}: remove these fixed entries from the allowlist`).toEqual([])
  })
})

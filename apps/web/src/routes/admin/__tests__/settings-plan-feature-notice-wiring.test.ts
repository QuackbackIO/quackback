/**
 * Each paid feature's settings page carries the paused notice for its own
 * feature, so the line shows on the page that sets the feature up and nowhere
 * else. Checked against the route sources: rendering every settings page here
 * would need its whole loader graph. The flag check before the notice body
 * loads is checked the same way; settings.plan-feature-notice.test.tsx
 * renders one page to prove what it does.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(file: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', file), 'utf8')
}

const FEATURES = new Set([
  'webhooks',
  'workflows',
  'integrations',
  'customDomain',
  'customCss',
  'aiAssistant',
  'aiArticleTranslation',
])

/** The feature keys named by each notice in `file` (a tab condition's other words left out). */
function noticeFeatures(file: string): string[] {
  const features: string[] = []
  for (const match of source(file).matchAll(
    /<PlanFeatureNotice\s+feature=\{?([^/>]+?)\}?\s*\/>/g
  )) {
    for (const key of match[1]!.matchAll(/'([A-Za-z]+)'|"([A-Za-z]+)"/g)) {
      const name = key[1] ?? key[2]!
      if (FEATURES.has(name)) features.push(name)
    }
  }
  return features.sort()
}

describe('the paused notice on each settings page', () => {
  it.each([
    ['settings.developers.tsx', ['webhooks']],
    ['settings.workflows.tsx', ['workflows']],
    ['settings.integrations.index.tsx', ['integrations']],
    ['settings.agent.tsx', ['aiAssistant']],
    ['settings.help-center.tsx', ['aiArticleTranslation']],
    // The Custom domains tab and the Design tab (custom CSS) of Settings > Portal.
    ['settings.portal.tsx', ['customCss', 'customDomain', 'customDomain']],
  ])('%s names %j', (file, features) => {
    expect(noticeFeatures(file)).toEqual(features)
  })

  // A notice module shared by these routes becomes a chunk of its own, one
  // more request on each page even with the flag off. Each page checks the
  // flag itself and only then loads the body.
  it.each([
    'settings.developers.tsx',
    'settings.workflows.tsx',
    'settings.integrations.index.tsx',
    'settings.agent.tsx',
    'settings.help-center.tsx',
    'settings.portal.tsx',
  ])('%s checks the flag before loading the notice body', (file) => {
    const text = source(file)
    expect(text).not.toMatch(/from '@\/components\/admin\/settings\/plan-feature-notice'/)
    expect(text).toContain(
      "lazy(\n  () => import('@/components/admin/settings/plan-feature-notice-body')\n)"
    )
    expect(text).toMatch(
      /function PlanFeatureNotice\([^)]*\) \{\n {2}const enabled = useWorkspaceSettings\(\)\?\.featureFlags\?\.planLimits === true\n {2}if \(!enabled\) return null\n/
    )
  })

  it('shows custom CSS on the Design tab and the custom domain on the Custom domains tab', () => {
    expect(source('settings.portal.tsx')).toContain(
      "<PlanFeatureNotice feature={tab === 'design' ? 'customCss' : 'customDomain'} />"
    )
  })
})

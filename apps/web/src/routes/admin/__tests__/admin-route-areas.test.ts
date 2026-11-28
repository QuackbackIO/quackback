/**
 * Guard: every admin page belongs to one admin message area or to the shell,
 * and the route that renders it seeds that area in its loader
 * (`seedAdminAreas`), so a translated page carries its own strings and no one
 * else's. A new admin page fails here until it is given its area.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AREA_MESSAGE_PREFIXES, type MessageArea } from '@/lib/shared/i18n'

const ADMIN_ROUTES = resolve(__dirname, '..')

/**
 * 'shell': the shell's strings, which the admin layout seeds.
 * 'parent': the page renders inside a layout route that seeds its area.
 */
type Expected = MessageArea[] | 'shell' | 'parent'

const PAGES: Record<string, Expected> = {
  'index.tsx': 'shell',
  'getting-started.tsx': 'shell',
  'search.tsx': 'shell',
  'notifications.tsx': 'shell',
  'settings.tsx': 'shell',
  'settings.index.tsx': 'shell',
  'settings.notifications.tsx': 'shell',

  'inbox.tsx': ['adminInbox'],

  'feedback.tsx': ['adminProduct'],
  'feedback.index.tsx': 'parent',
  'feedback.moderation.tsx': 'parent',
  'roadmap.tsx': ['adminProduct'],
  'changelog.tsx': ['adminProduct'],
  'analytics.tsx': ['adminProduct'],

  'users.tsx': ['adminPeople'],

  'help-center.tsx': ['adminHelpCenter'],
  'help-center.index.tsx': 'parent',
  'help-center.articles.$articleId.tsx': 'parent',
  'status.tsx': ['adminHelpCenter'],

  'settings.agent.tsx': ['adminAutomation'],
  'settings.copilot.tsx': ['adminAutomation'],
  'settings.skills.tsx': ['adminAutomation'],
  'settings.connectors.tsx': ['adminAutomation'],
  'settings.connectors_.$connectorId.tsx': ['adminAutomation'],
  'settings.workflows.tsx': ['adminAutomation'],
  'settings_.workflows.$workflowId.tsx': ['adminAutomation'],

  'settings.general.tsx': ['adminWorkspaceSettings'],
  'settings.members.tsx': ['adminWorkspaceSettings'],
  'settings.members_.roles.$roleId.tsx': ['adminWorkspaceSettings'],
  'settings.members_.roles.new.tsx': ['adminWorkspaceSettings'],
  'settings.billing.tsx': ['adminWorkspaceSettings'],
  'settings.billing_.checkout.tsx': ['adminWorkspaceSettings'],
  'settings.billing_.limits.tsx': ['adminWorkspaceSettings'],
  'settings.security.authentication.tsx': ['adminWorkspaceSettings'],
  'settings.security.sso_.$providerId.tsx': ['adminWorkspaceSettings'],
  'settings.security.sso_.new.tsx': ['adminWorkspaceSettings'],
  'settings.domains.tsx': ['adminWorkspaceSettings'],
  'settings.domains_.$domain.tsx': ['adminWorkspaceSettings'],
  'settings.email.tsx': ['adminWorkspaceSettings'],
  'settings.labs.tsx': ['adminWorkspaceSettings'],

  'settings.portal.tsx': ['adminChannelSettings'],
  'settings_.portal.customise.tsx': ['adminChannelSettings'],
  'settings.widget.tsx': ['adminChannelSettings'],
  'settings.widget.install.tsx': ['adminChannelSettings'],
  'settings.boards.index.tsx': ['adminChannelSettings'],
  'settings.boards.$slug.tsx': ['adminChannelSettings'],
  'settings.help-center.tsx': ['adminChannelSettings'],
  'settings.channels.tsx': ['adminChannelSettings'],
  'settings.channels_.email.tsx': ['adminChannelSettings'],
  'settings.channels_.github.tsx': ['adminChannelSettings'],
  'settings.channels_.messenger.tsx': ['adminChannelSettings'],
  'settings.changelog.tsx': ['adminChannelSettings'],
  'settings.statuses.tsx': ['adminChannelSettings'],
  'settings.status.tsx': ['adminChannelSettings'],
  'settings.moderation.tsx': ['adminChannelSettings'],
  'settings.macros.tsx': ['adminChannelSettings'],
  'settings.tags.tsx': ['adminChannelSettings'],
  'settings.ticket-statuses.tsx': ['adminChannelSettings'],
  'settings.ticket-types.tsx': ['adminChannelSettings'],
  'settings.sla.tsx': ['adminChannelSettings'],
  'settings.office-hours.tsx': ['adminChannelSettings'],

  'settings.integrations.index.tsx': ['adminIntegrationSettings', 'adminIntegrationCatalog'],
  'settings/integrations/$type.tsx': ['adminIntegrationSettings', 'adminIntegrationCatalog'],
  'settings.developers.tsx': ['adminIntegrationSettings'],
  'settings.developers_.workspace-keys.new.tsx': ['adminIntegrationSettings'],
  'settings.imports.tsx': ['adminIntegrationSettings'],
  'settings.conversation-data.tsx': ['adminIntegrationSettings'],
  'settings.people.tsx': ['adminIntegrationSettings'],
  'settings.companies.tsx': ['adminIntegrationSettings'],
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') routeFiles(path, out)
    } else if (name.endsWith('.tsx')) out.push(path)
  }
  return out
}

const pages = routeFiles(ADMIN_ROUTES)
  .map((path) => ({ file: relative(ADMIN_ROUTES, path), source: readFileSync(path, 'utf8') }))
  // A page renders something; a retired path only redirects.
  .filter(({ source }) => /\n {2}component: /.test(source))

/** The areas a route's loader seeds, in order. */
function seededAreas(source: string): string[] {
  return [...source.matchAll(/seedAdminAreas\(\s*context\.personLocale,\s*([^)]*)\)/g)].flatMap(
    (match) => [...match[1]!.matchAll(/'([A-Za-z]+)'/g)].map((area) => area[1]!)
  )
}

describe('admin pages seed their message area', () => {
  it('finds the admin pages', () => {
    expect(pages.length).toBeGreaterThan(50)
  })

  it('every admin page is given an area or the shell', () => {
    expect(pages.map(({ file }) => file).filter((file) => !(file in PAGES))).toEqual([])
  })

  it('names only pages that exist', () => {
    const files = new Set(pages.map(({ file }) => file))
    expect(Object.keys(PAGES).filter((file) => !files.has(file))).toEqual([])
  })

  it('names only real areas', () => {
    const areas = Object.values(PAGES).flatMap((expected) =>
      Array.isArray(expected) ? expected : []
    )
    expect(areas.filter((area) => !(area in AREA_MESSAGE_PREFIXES))).toEqual([])
  })

  it.each(pages.map(({ file }) => file))('%s seeds its areas', (file) => {
    const source = pages.find((page) => page.file === file)!.source
    const expected = PAGES[file]
    expect(seededAreas(source)).toEqual(Array.isArray(expected) ? expected : [])
  })

  it('each layout route that seeds for its pages renders them in an Outlet', () => {
    for (const parent of ['feedback.tsx', 'help-center.tsx']) {
      expect(pages.find((page) => page.file === parent)!.source).toContain('<Outlet')
    }
  })
})

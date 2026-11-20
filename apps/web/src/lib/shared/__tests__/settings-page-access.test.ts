/**
 * Every admin settings page opens to the viewers its reads serve: a role
 * either gets a page that loads, or no page and no nav row for it.
 *
 * The reads are taken from the source (settings-page-reads.ts): each route's
 * loader, the queries it awaits, and the permission each query's server
 * function enforces, as the authorization-matrix scanner reads it. So a gate
 * edited on either side, the route or the server function, fails here.
 */
import { describe, expect, it } from 'vitest'
import {
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  type PermissionKey,
  type SystemRoleKey,
} from '@/lib/shared/permissions'
import {
  SETTINGS_PAGE_ACCESS,
  SETTINGS_PAGE_ACTIONS,
  canOpenSettingsPage,
  type GatedSettingsPage,
} from '@/lib/shared/settings-page-access'
import {
  buildNavSections,
  isNavModule,
  navSectionsFor,
  type NavItem,
} from '@/lib/shared/settings-nav-sections'
import {
  readRoute,
  settingsRouteFiles,
  type RouteReads,
  type ServerRead,
} from './settings-page-reads'

/** Settings routes with no gate: each redirects, lays out, or is personal. */
const OPEN_PAGES: Record<string, string> = {
  '/admin/settings': 'the settings layout and its index, which redirect to a page the viewer has',
  '/admin/settings/notifications': "the viewer's own notification preferences",
  '/admin/settings/ai': 'moved: redirects to Agent',
  '/admin/settings/branding': 'moved: redirects to Portal',
  '/admin/settings/conversations': 'moved: redirects',
  '/admin/settings/feedback': "a module's hub: redirects to its first page the viewer has",
  '/admin/settings/support': "a module's hub: redirects to its first page the viewer has",
  '/admin/settings/mcp': 'moved: redirects to Developers',
  '/admin/settings/security/audit-log': 'moved: redirects to the Access & Security tab',
  '/admin/settings/security/sso': 'moved: redirects',
  '/admin/settings/team': 'moved: redirects to Members & Teams',
  '/admin/settings/teams': 'moved: redirects to Members & Teams',
}

/**
 * Reads a page warms whose failure the page survives, though the gate does not
 * cover them. Each says what the viewer sees instead.
 */
const TOLERATED_WARM_READS: Record<string, Record<string, string>> = {
  '/admin/settings/imports': {
    fetchBoardsFn: "the CSV import's board picker lists no boards without board.manage",
  },
}

const routes: RouteReads[] = settingsRouteFiles()
  .map(readRoute)
  .filter((r): r is RouteReads => r !== null)

const gated = routes.filter((r) => r.gatePath !== null)

const passes = (read: ServerRead, held: ReadonlySet<string>) =>
  read.needs === null || read.needs.some((p) => held.has(p))

/** The reads a viewer must pass for the page to work. */
function requiredReads(route: RouteReads): ServerRead[] {
  const tolerated = TOLERATED_WARM_READS[route.path] ?? {}
  return route.reads.filter(
    (r) => r.kind === 'essential' || (r.kind === 'warm' && !(r.fn in tolerated))
  )
}

function gateOf(route: RouteReads) {
  return SETTINGS_PAGE_ACCESS[route.path as GatedSettingsPage]
}

describe('settings routes', () => {
  it('reads every route', () => {
    expect(routes.length).toBeGreaterThan(50)
    for (const route of routes) expect(route.unresolved, route.file).toEqual([])
  })

  it('gates every page through SETTINGS_PAGE_ACCESS, under its own path', () => {
    for (const route of routes) {
      expect(route.otherAsserts, route.file).toEqual([])
      if (route.gatePath === null) {
        expect(OPEN_PAGES, `${route.file} has no gate`).toHaveProperty([route.path])
        expect(route.reads.filter((r) => r.needs !== null && r.kind !== 'warm')).toEqual([])
      } else {
        expect(route.gatePath, route.file).toBe(route.path)
        expect(SETTINGS_PAGE_ACCESS, route.file).toHaveProperty([route.path])
      }
    }
  })

  it('has a route for every gated page', () => {
    const paths = new Set(gated.map((r) => r.path))
    for (const path of Object.keys(SETTINGS_PAGE_ACCESS)) expect(paths, path).toContain(path)
  })
})

describe('each settings page opens to whom its reads serve', () => {
  it.each(gated.map((r) => [r.path, r] as const))(
    '%s: every way in can make every read the page needs',
    (_path, route) => {
      const failures: string[] = []
      for (const way of gateOf(route)) {
        const held = new Set<string>(way)
        for (const read of requiredReads(route)) {
          if (!passes(read, held)) {
            failures.push(`[${way.join(' + ')}] cannot ${read.fn} (needs ${read.needs})`)
          }
        }
        // A read made only behind a permission check: the check must be the
        // read's own permission, or one the gate already gives.
        for (const read of route.reads.filter((r) => r.kind === 'guarded')) {
          if (!passes(read, new Set([...way, ...read.guard]))) {
            failures.push(
              `[${way.join(' + ')}] reads ${read.fn} behind ${read.guard}, which needs ${read.needs}`
            )
          }
        }
      }
      expect(failures).toEqual([])
    }
  )

  it.each(gated.map((r) => [r.path, r] as const))(
    '%s: asks for nothing the page does not need',
    (_path, route) => {
      const needed = new Set<string>([
        ...requiredReads(route).flatMap((r) => r.needs ?? []),
        ...(SETTINGS_PAGE_ACTIONS[route.path as GatedSettingsPage] ?? []),
      ])
      const extra = gateOf(route)
        .flat()
        .filter((p) => !needed.has(p))
      expect(extra).toEqual([])
    }
  )
})

/** Roles to check: the presets, and custom roles that hold one side of each pairing. */
const ROLES: Record<string, ReadonlySet<PermissionKey>> = {
  ...Object.fromEntries(
    (Object.keys(SYSTEM_ROLE_PERMISSIONS) as SystemRoleKey[]).map((key) => [
      key,
      new Set(SYSTEM_ROLE_PERMISSIONS[key]),
    ])
  ),
  // Granular grants a custom role may hold without the settings.manage beside them.
  'custom: granular settings': new Set([
    PERMISSIONS.SETTINGS_MODERATION,
    PERMISSIONS.SETTINGS_BRANDING,
    PERMISSIONS.AUTH_MANAGE,
    PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
    PERMISSIONS.WORKFLOW_MANAGE,
    PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.CONVERSATION_MANAGE,
    PERMISSIONS.INTEGRATION_VIEW,
    PERMISSIONS.TICKET_MANAGE_TYPES,
  ]),
  // The read side of the same pages.
  'custom: reads only': new Set([
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.ROUTING_MANAGE,
    PERMISSIONS.MEMBER_VIEW,
    PERMISSIONS.CONVERSATION_REPLY,
    PERMISSIONS.TAG_VIEW,
    PERMISSIONS.STATUS_VIEW,
    PERMISSIONS.TICKET_VIEW,
  ]),
}

describe.each(Object.entries(ROLES))('%s', (_name, held) => {
  it('opens only pages whose reads it passes', () => {
    const broken = gated
      .filter((route) => canOpenSettingsPage(held, route.path as GatedSettingsPage))
      .flatMap((route) =>
        requiredReads(route)
          .filter((read) => !passes(read, held))
          .map((read) => `${route.path}: ${read.fn} needs ${read.needs}`)
      )
    expect(broken).toEqual([])
  })

  it('is offered in the settings nav exactly the pages it can open', () => {
    const all = buildNavSections(
      { supportInbox: true, supportTickets: true, support: true } as never,
      true
    )
    const items = (sections: typeof all) =>
      sections
        .flatMap((s) => s.items)
        .flatMap((e) => (isNavModule(e) ? e.pages : [e]))
        .filter((item): item is NavItem & { to: GatedSettingsPage } => item.gate !== undefined)
    const shown = new Set(items(navSectionsFor(all, held)).map((i) => i.to))
    for (const item of items(all)) {
      expect(shown.has(item.to), item.to).toBe(canOpenSettingsPage(held, item.to))
      expect(item.gate, item.to).toEqual(SETTINGS_PAGE_ACCESS[item.to])
    }
  })
})

describe('pages owned by a narrower permission', () => {
  const opens = (held: Iterable<PermissionKey>, path: GatedSettingsPage) =>
    canOpenSettingsPage(new Set(held), path)

  it('opens Support > GitHub to a Support lead, whose channel_account.manage reads its status', () => {
    expect(opens(SYSTEM_ROLE_PERMISSIONS.support_lead, '/admin/settings/channels/github')).toBe(
      true
    )
    expect(opens([PERMISSIONS.CHANNEL_ACCOUNT_MANAGE], '/admin/settings/channels/github')).toBe(
      true
    )
  })

  it('opens Moderation to settings.moderation and Portal to settings.branding, alone', () => {
    expect(opens([PERMISSIONS.SETTINGS_MODERATION], '/admin/settings/moderation')).toBe(true)
    expect(opens([PERMISSIONS.SETTINGS_BRANDING], '/admin/settings/portal')).toBe(true)
    expect(opens([PERMISSIONS.SETTINGS_MANAGE], '/admin/settings/moderation')).toBe(false)
    expect(opens([PERMISSIONS.SETTINGS_MANAGE], '/admin/settings/portal')).toBe(false)
  })
})

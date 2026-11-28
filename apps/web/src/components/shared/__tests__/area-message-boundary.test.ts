/**
 * Guard: each area's strings (`AREA_MESSAGE_PREFIXES`) are left out of the
 * catalog every page seeds, so they show only where the area supplies them:
 *   - only the area's own modules use them;
 *   - an area whose routes read its strings in the loader has its modules
 *     imported, however indirectly, only from those routes;
 *   - an area that loads as it opens is mounted, by name, wherever it is shown.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AREA_MESSAGE_PREFIXES, messageArea, type MessageArea } from '@/lib/shared/i18n'
import en from '@/locales/en.json'

const SRC = resolve(__dirname, '../../..')

/**
 * Per area: the modules that may use its strings and, for an area its route
 * loaders read, the modules that may import those (null for an area that loads
 * its own strings, or the private portal's gate, which loads the whole catalog).
 */
const AREAS: Record<MessageArea, { users: RegExp; importers: RegExp | null }> = {
  notificationPreferences: {
    users: /^components\/settings\/notification-matrix-(form\.tsx|admin-labels\.ts)$/,
    importers:
      /^(routes\/(_portal\/settings\.preferences|admin\/settings\.notifications)\.tsx|components\/settings\/notification-matrix-form\.tsx)$/,
  },
  personalApiKeys: {
    users: /^components\/settings\/api-keys\//,
    importers: /^(components\/settings\/api-keys\/|routes\/_portal\/settings\.api-keys\.tsx$)/,
  },
  settings: {
    users:
      /^(components\/settings\/(email-field|language-select|password-form|profile-form|settings-nav|two-factor-section)\.tsx|routes\/_portal\/settings\.[a-z-]+\.tsx)$/,
    importers: /^(components\/settings\/|routes\/_portal\/settings(\.[a-z-]+)?\.tsx$)/,
  },
  helpCenter: {
    users: /^(components\/help-center\/|routes\/_portal\/hc\/)/,
    importers: /^(components\/help-center\/|routes\/_portal\/hc(\.tsx$|\/))/,
  },
  twoFactor: {
    users: /^components\/auth\/two-factor-(challenge-step|enroll-steps)\.tsx$/,
    importers: null,
  },
  notificationText: {
    users: /^lib\/shared\/notifications\/notification-text\.ts$/,
    importers: null,
  },
  accessGate: {
    users: /^components\/portal\/portal-access-gate\.tsx$/,
    importers: null,
  },
  errorPage: {
    users: /^components\/shared\/(error-page\.tsx|seat-paused-page\.tsx|plan-refusal-copy\.ts)$/,
    importers: null,
  },
  deviceSignIn: {
    users: /^(components\/device\/device-approval\.tsx|routes\/device\.tsx)$/,
    importers: /^routes\/device\.tsx$/,
  },
  languageSettings: {
    users: /^components\/admin\/settings\/(language\/|help-center\/domains-languages-tab\.tsx$)/,
    importers: null,
  },
  // The admin areas: each is seeded by the loaders of its routes (see
  // `seedAdminAreas`), so its strings may be used by the area's own modules
  // and reached only through those routes.
  adminInbox: {
    users:
      /^(components\/admin\/(inbox|conversation)\/|components\/conversation\/|lib\/client\/hooks\/use-inbox-translation\.ts$|routes\/admin\/inbox\.tsx$)/,
    importers:
      /^(components\/admin\/(inbox|conversation)\/|components\/conversation\/|lib\/client\/hooks\/use-inbox-translation\.ts$|routes\/admin\/inbox\.tsx$)/,
  },
  adminProduct: {
    users:
      /^(components\/admin\/(feedback|changelog|analytics|roadmap)\/|components\/admin\/roadmap-[a-z-]+\.tsx$|routes\/admin\/(feedback|roadmap|changelog|analytics)(\.[a-z]+)?\.tsx$)/,
    importers:
      /^(components\/admin\/(feedback|changelog|analytics|roadmap)\/|components\/admin\/roadmap-[a-z-]+\.tsx$|routes\/admin\/(feedback|roadmap|changelog|analytics)(\.[a-z]+)?\.tsx$)/,
  },
  adminPeople: {
    users: /^(components\/admin\/(users|segments)\/|routes\/admin\/users\.tsx$)/,
    importers: /^(components\/admin\/(users|segments)\/|routes\/admin\/users\.tsx$)/,
  },
  adminHelpCenter: {
    users:
      /^(components\/admin\/(help-center|status)\/|routes\/admin\/(help-center|status)[.a-zA-Z$]*\.tsx$)/,
    importers:
      /^(components\/admin\/(help-center|status)\/|routes\/admin\/(help-center|status)[.a-zA-Z$]*\.tsx$)/,
  },
  adminAutomation: {
    users:
      /^(components\/admin\/automation\/|routes\/admin\/settings_?\.(agent|copilot|skills|connectors|workflows)[.a-zA-Z_$]*\.tsx$)/,
    importers:
      /^(components\/admin\/automation\/|routes\/admin\/settings_?\.(agent|copilot|skills|connectors|workflows)[.a-zA-Z_$]*\.tsx$)/,
  },
  adminWorkspaceSettings: {
    users:
      /^(components\/admin\/settings\/(billing|security|team|teams|auth-shared)\/|components\/admin\/settings\/(workspace-[a-z-]+|domain[a-z-]*|add-[a-z-]*domain-dialog)\.tsx$|routes\/admin\/settings\.(general|members|billing|security|domains|labs|email)[.a-zA-Z_$]*\.tsx$)/,
    importers:
      /^(components\/admin\/settings\/(billing|security|team|teams|auth-shared)\/|components\/admin\/settings\/(workspace-[a-z-]+|domain[a-z-]*|add-[a-z-]*domain-dialog)\.tsx$|routes\/admin\/settings\.(general|members|billing|security|domains|labs|email)[.a-zA-Z_$]*\.tsx$)/,
  },
  adminChannelSettings: {
    users:
      /^(components\/admin\/settings\/(boards|branding|changelog|help-center|portal-auth|portal-customise|status|statuses|tags|tickets|widget)\/|components\/admin\/settings\/[a-z-]*(channel|portal|moderation|macros|sla)[a-z-]*\.tsx$|routes\/admin\/settings_?\.(portal|widget|boards|help-center|channels|changelog|statuses|status|moderation|macros|tags|ticket-statuses|ticket-types|sla|office-hours)[.a-zA-Z_$-]*\.tsx$)/,
    importers:
      /^(components\/admin\/settings\/(boards|branding|changelog|help-center|portal-auth|portal-customise|status|statuses|tags|tickets|widget)\/|components\/admin\/settings\/[a-z-]*(channel|portal|moderation|macros|sla)[a-z-]*\.tsx$|routes\/admin\/settings_?\.(portal|widget|boards|help-center|channels|changelog|statuses|status|moderation|macros|tags|ticket-statuses|ticket-types|sla|office-hours)[.a-zA-Z_$-]*\.tsx$)/,
  },
  adminIntegrationSettings: {
    users:
      /^(components\/admin\/settings\/(api-keys|integrations|webhooks|mcp|imports|conversation-data|user-attributes|company-attributes)\/|routes\/admin\/settings(\.(integrations\.index|developers[a-z._-]*|imports|conversation-data|people|companies)|\/integrations\/\$type)\.tsx$)/,
    importers:
      /^(components\/admin\/settings\/(api-keys|integrations|webhooks|mcp|imports|conversation-data|user-attributes|company-attributes)\/|routes\/admin\/settings(\.(integrations\.index|developers[a-z._-]*|imports|conversation-data|people|companies)|\/integrations\/\$type)\.tsx$)/,
  },
  adminIntegrationCatalog: {
    users:
      /^(integrations\/|routes\/admin\/settings(\.integrations\.index|\/integrations\/\$type)\.tsx$)/,
    importers:
      /^(integrations\/|components\/admin\/settings\/integrations\/|routes\/admin\/settings(\.integrations\.index|\/integrations\/\$type)\.tsx$)/,
  },
  statusPage: {
    users: /^(components\/portal\/status\/|routes\/_portal\/status\.(index|\$incidentId)\.tsx$)/,
    importers:
      /^(components\/portal\/status\/|routes\/_portal\/status\.(index|\$incidentId)\.tsx$)/,
  },
}

/**
 * Imports that never show the area's strings, each with the reason. A shared
 * part can import a module of an area for a case it never meets.
 */
const NEVER_SHOWN = new Set<string>([
  // The "via API" mark: the server sets `viaApi` on team views only, so a
  // visitor's thread never shows it.
  'components/shared/conversation/visitor-conversation-thread.tsx -> components/conversation/message-bubble.tsx',
])

/** Where an area that loads as it opens is shown, and so must be mounted. */
const SHOWN_BY: { area: MessageArea; marker: RegExp }[] = [
  { area: 'twoFactor', marker: /<(ChallengeStep|EnrollSteps)\b/ },
  { area: 'notificationText', marker: /<NotificationItem\b/ },
  { area: 'languageSettings', marker: /<(LanguageCard|MainLanguageRow)\b/ },
]

/**
 * The areas whose strings a source names: a quoted id under an area prefix
 * (a prefix, as in the prefix list itself, is not a use).
 */
function areasUsed(source: string): Set<MessageArea> {
  const used = new Set<MessageArea>()
  for (const prefixes of Object.values(AREA_MESSAGE_PREFIXES)) {
    for (const prefix of prefixes) {
      for (const quote of ["'", '"', '`']) {
        const needle = quote + prefix
        for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) {
          const id = /^[A-Za-z][\w.-]*/.exec(source.slice(at + needle.length))?.[0]
          const area = id && !id.endsWith('.') && messageArea(prefix + id)
          if (area) used.add(area)
        }
      }
    }
  }
  return used
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'locales') sourceFiles(path, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'routeTree.gen.ts') {
      out.push(path)
    }
  }
  return out
}

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
// A lazy chunk (`import('...')`) renders where its importer shows it, so it
// counts as an import too.
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveImport(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier)
  else return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

const rel = (path: string) => relative(SRC, path)
const files = sourceFiles(SRC).map(rel)
const sources = new Map(files.map((path) => [path, readFileSync(join(SRC, path), 'utf8')]))

/** Each module's static importers. */
const importersOf = new Map<string, string[]>()
for (const [importer, source] of sources) {
  for (const match of [...source.matchAll(STATIC_IMPORT), ...source.matchAll(DYNAMIC_IMPORT)]) {
    const target = resolveImport(join(SRC, importer), match[1]!)
    if (!target) continue
    const list = importersOf.get(rel(target)) ?? []
    list.push(importer)
    importersOf.set(rel(target), list)
  }
}

const usersOf = new Map<MessageArea, string[]>()
for (const [path, source] of sources) {
  for (const area of areasUsed(source)) {
    usersOf.set(area, [...(usersOf.get(area) ?? []), path])
  }
}

const areas = Object.keys(AREAS) as MessageArea[]

describe('area strings stay with their area', () => {
  it.each(areas)('%s strings are used only by its modules', (area) => {
    const users = usersOf.get(area) ?? []
    // An area with no strings yet (an admin area before its strings move to
    // the catalog) has nothing to use; once it has one, something must.
    if (Object.keys(en).some((key) => messageArea(key) === area)) {
      expect(users.length).toBeGreaterThan(0)
    }
    expect(users.filter((path) => !AREAS[area].users.test(path))).toEqual([])
  })

  it.each(areas.filter((area) => AREAS[area].importers))(
    '%s modules are imported only from the routes that load its strings',
    (area) => {
      const allowed = AREAS[area].importers!
      const leaks: string[] = []
      const seen = new Set<string>()
      const queue = [...(usersOf.get(area) ?? [])]
      while (queue.length > 0) {
        const target = queue.shift()!
        if (seen.has(target)) continue
        seen.add(target)
        for (const importer of importersOf.get(target) ?? []) {
          // A module that mounts the area itself loads its strings as it
          // opens, wherever it is shown (an admin modal, say).
          if (sources.get(importer)!.includes(`area="${area}"`)) continue
          if (allowed.test(importer)) queue.push(importer)
          else if (!NEVER_SHOWN.has(`${importer} -> ${target}`))
            leaks.push(`${importer} -> ${target}`)
        }
      }
      expect(leaks).toEqual([])
    }
  )

  it.each(SHOWN_BY)('$area is mounted wherever it is shown', ({ area, marker }) => {
    const showing = files.filter((path) => marker.test(sources.get(path)!))
    expect(showing.length).toBeGreaterThan(0)
    expect(showing.filter((path) => !sources.get(path)!.includes(`area="${area}"`))).toEqual([])
  })
})

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

const SRC = resolve(__dirname, '../../..')

/**
 * Per area: the modules that may use its strings and, for an area its route
 * loaders read, the modules that may import those (null for an area that loads
 * its own strings, or the private portal's gate, which loads the whole catalog).
 */
const AREAS: Record<MessageArea, { users: RegExp; importers: RegExp | null }> = {
  notificationPreferences: {
    users: /^components\/settings\/notification-matrix-form\.tsx$/,
    importers: /^routes\/(_portal\/settings\.preferences|admin\/settings\.notifications)\.tsx$/,
  },
  settings: {
    users:
      /^(components\/settings\/(email-field|password-form|profile-form|settings-nav|two-factor-section)\.tsx|routes\/_portal\/settings\.[a-z]+\.tsx)$/,
    importers: /^(components\/settings\/|routes\/_portal\/settings(\.[a-z]+)?\.tsx$)/,
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
    users: /^components\/shared\/error-page\.tsx$/,
    importers: null,
  },
}

/** Where an area that loads as it opens is shown, and so must be mounted. */
const SHOWN_BY: { area: MessageArea; marker: RegExp }[] = [
  { area: 'twoFactor', marker: /<(ChallengeStep|EnrollSteps)\b/ },
  { area: 'notificationText', marker: /<NotificationItem\b/ },
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
  for (const match of source.matchAll(STATIC_IMPORT)) {
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
    expect(users.length).toBeGreaterThan(0)
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
          if (allowed.test(importer)) queue.push(importer)
          else leaks.push(`${importer} -> ${target}`)
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

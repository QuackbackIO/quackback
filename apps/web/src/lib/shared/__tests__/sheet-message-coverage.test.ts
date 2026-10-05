// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { isLaunchMessage, isSheetMessage } from '@/lib/shared/i18n'

// Admin pages seed their catalog without the strings of a few surfaces, which
// load their own as they open. A string a page renders outside its surface
// would show its English default in every other language, so only the
// surface's own files may name one. Server code formats with the whole catalog.
const APP_SRC = fileURLToPath(new URL('../../../', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === '__mocks__' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Every dotted `onboarding.` id a file names, template prefixes included. */
function messageIds(source: string): string[] {
  return [...source.matchAll(/['"`](onboarding\.[\w-]+\.[\w.-]*)/g)].map((m) => m[1])
}

function namedOutside(isMember: (key: string) => boolean, owners: ReadonlySet<string>): string[] {
  const outside: string[] = []
  for (const file of walk(APP_SRC)) {
    const path = relative(APP_SRC, file)
    if (owners.has(path) || path === 'lib/shared/i18n.ts' || path.startsWith('lib/server/'))
      continue
    for (const id of messageIds(readFileSync(file, 'utf8'))) {
      if (isMember(id)) outside.push(`${path}: ${id}`)
    }
  }
  return outside
}

describe('lazily loaded strings', () => {
  it('setup sheet strings are named only by the sheets that load them', () => {
    const sheets = new Set([
      'components/onboarding/try-messenger-sheet.tsx',
      'components/onboarding/install-messenger-sheet.tsx',
      'components/onboarding/invite-team-sheet.tsx',
    ])
    expect(namedOutside(isSheetMessage, sheets)).toEqual([])
  })

  it('launch plan strings are named only by Home and the Launch plan page', () => {
    const launch = new Set([
      'components/onboarding/home-greeting.tsx',
      'components/onboarding/home-launch-chips.tsx',
      'components/onboarding/home-next-step.tsx',
      'components/onboarding/home-first-win.tsx',
      'components/onboarding/launch-plan-page.tsx',
      'components/onboarding/launch-step-action.tsx',
      'components/onboarding/launch-task-label.tsx',
      'components/admin/branding/automatic-branding-notice.tsx',
      'components/admin/branding/use-automatic-website-branding.ts',
      'lib/shared/launch-checklist.ts',
      'lib/shared/launch-outcomes.ts',
    ])
    expect(namedOutside(isLaunchMessage, launch)).toEqual([])
    // And only those two routes render the components that name them.
    const containers = new Set([
      ...launch,
      'components/onboarding/home-launch-plan.tsx',
      'components/onboarding/home-try-it.tsx',
      'routes/admin/index.tsx',
      'routes/admin/getting-started.tsx',
    ])
    const strayImports: string[] = []
    for (const file of walk(APP_SRC)) {
      const path = relative(APP_SRC, file)
      if (containers.has(path)) continue
      const source = readFileSync(file, 'utf8')
      for (const owner of containers) {
        if (!owner.startsWith('components/') || !owner.includes('/onboarding/')) continue
        const module = owner
          .replace(/\.tsx?$/, '')
          .split('/')
          .pop()
        if (new RegExp(`from '[^']*/${module}'`).test(source))
          strayImports.push(`${path} -> ${owner}`)
      }
    }
    expect(strayImports).toEqual([])
  })
})

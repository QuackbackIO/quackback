/**
 * `writeCloudConfig` is the *only* writer of `settings.cloud`, enforced by
 * scanning the source rather than by saying so in a comment.
 *
 * This exists because the claim used to be false. The module documented
 * itself as "the single mutation seam" while the declarative config-file
 * reconciler wrote the column directly through `deps.updateSettings` — which
 * meant it skipped `validatePatch()`, and, more seriously, computed its merge
 * outside the row lock and could silently erase the other writer.
 *
 * A prose claim of exclusivity that nothing checks decays the first time
 * someone adds a convenient `.set({ cloud })`. So it is checked.
 *
 * The same argument applies to `tier_limits`, which gained a second writer at
 * the same time and now has its own seam in `tier-limits.write.ts`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { walkSourceFiles } from '@/lib/server/policy/source-files'

/**
 * Resolved from this file's own location, never from `process.cwd()`.
 *
 * The first version used `join(process.cwd(), 'src/lib/server')`, which is
 * only correct when vitest is invoked from `apps/web`. The repo's actual test
 * command runs the root config from the repo root, where that path does not
 * exist — so the whole file threw ENOENT at collection and vitest reported it
 * as `(0 test)`. It never ran, while being cited as one of the three
 * mechanisms keeping the single-writer claim true.
 *
 * `existsSync` below is the guard against that recurring: a scanner that
 * cannot find its own source tree must fail loudly, not scan an empty list
 * and report no offenders.
 */
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/**
 * Files permitted to UPDATE each column, relative to `src/lib/server`.
 *
 * Updates are the dangerous half: an update is a read-modify-write over a
 * value another writer may have changed. Inserts are handled separately
 * below, because seeding a row that does not exist yet cannot lose anyone
 * else's write.
 */
const ALLOWED_UPDATERS: Record<string, string[]> = {
  cloud: ['domains/settings/cloud/cloud.service.ts'],
  tierLimits: ['domains/settings/tier-limits.write.ts'],
}

/**
 * Files permitted to seed each column on a fresh row.
 *
 * `config-file/deps.ts` bootstraps the very first `settings` row on a new
 * install, before any seam has a row to lock. That is legitimate and cannot
 * race — but it must stay an INSERT: an update from that file would be the
 * bug this suite exists to prevent, and is still caught above.
 */
const ALLOWED_SEEDERS: Record<string, string[]> = {
  cloud: ['config-file/deps.ts'],
  tierLimits: ['config-file/deps.ts'],
}

const property = (column: string) => new RegExp(`(^|[\\s,{])${column}\\s*:`)

describe('the scanner itself', () => {
  it('can find the source tree it scans', () => {
    // The precondition, asserted rather than assumed. Without it a wrong root
    // makes every "no offenders" assertion below vacuously true — which is
    // exactly what happened: this file threw at collection under the repo's
    // real test command and had never executed once.
    expect({ root: SERVER_ROOT, exists: existsSync(SERVER_ROOT) }).toEqual({
      root: SERVER_ROOT,
      exists: true,
    })
  })

  it('walks a plausible number of files', () => {
    // A root that exists but is wrong (say, one directory too deep) would
    // still scan cleanly. `lib/server` is ~900 files; anything under a few
    // hundred means the walk is not seeing the tree.
    expect(walkSourceFiles(SERVER_ROOT).length).toBeGreaterThan(300)
  })

  it('detects a write when one is present', () => {
    // Proves the matcher is not simply never matching anything.
    expect(updatesColumn(`db.update(settings).set({ cloud: merged })`, 'cloud')).toBe(true)
    expect(updatesColumn(`db.update(settings).set({ name: 'x' })`, 'cloud')).toBe(false)
    expect(insertsColumn(`db.insert(settings).values({ cloud: seed })`, 'cloud')).toBe(true)
  })
})

/** A Drizzle update: `.set({ …, cloud: value, … })`. */
function updatesColumn(source: string, column: string): boolean {
  for (const call of source.matchAll(/\.set\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    if (property(column).test(call[1]!)) return true
  }
  return false
}

/** A Drizzle insert: `.values({ …, cloud: value, … })`. */
function insertsColumn(source: string, column: string): boolean {
  for (const call of source.matchAll(/\.values\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    if (property(column).test(call[1]!)) return true
  }
  return false
}

describe.each(Object.keys(ALLOWED_UPDATERS))('settings.%s has one writer', (column) => {
  it('is updated only from its declared seam', () => {
    const offenders: string[] = []
    for (const file of walkSourceFiles(SERVER_ROOT)) {
      const rel = relative(SERVER_ROOT, file)
      if (ALLOWED_UPDATERS[column]!.includes(rel)) continue
      if (updatesColumn(readFileSync(file, 'utf8'), column)) offenders.push(rel)
    }
    // Names, not a count, so a failure says which file to look at.
    expect(offenders.sort()).toEqual([])
  })

  it('is seeded only from the bootstrap path', () => {
    const offenders: string[] = []
    for (const file of walkSourceFiles(SERVER_ROOT)) {
      const rel = relative(SERVER_ROOT, file)
      if (ALLOWED_SEEDERS[column]!.includes(rel)) continue
      if (ALLOWED_UPDATERS[column]!.includes(rel)) continue
      if (insertsColumn(readFileSync(file, 'utf8'), column)) offenders.push(rel)
    }
    expect(offenders.sort()).toEqual([])
  })

  it('has a seam that actually exists', () => {
    // Guards the inverse failure: an allowlist entry pointing at a file that
    // was renamed, or a seam that stopped writing, would make the assertions
    // above pass vacuously.
    for (const rel of ALLOWED_UPDATERS[column]!) {
      const source = readFileSync(join(SERVER_ROOT, rel), 'utf8')
      expect({ rel, updates: updatesColumn(source, column) }).toEqual({ rel, updates: true })
    }
  })
})

describe('the config-file reconciler', () => {
  const reconciler = readFileSync(join(SERVER_ROOT, 'config-file/reconciler.ts'), 'utf8')

  it('routes its cloud write through the seam', () => {
    expect(reconciler).toContain('deps.applyCloudConfig(patch)')
  })

  it('routes its tier-limits write through the seam', () => {
    expect(reconciler).toContain('deps.applyTierLimits(spec.tierLimits)')
  })

  it('does not carry either column in the column update it builds', () => {
    // The specific shape of the old bug: `update.cloud = merged`, computed
    // from a row read earlier in the function and written whole.
    expect(reconciler).not.toMatch(/update\.cloud\s*=/)
    expect(reconciler).not.toMatch(/update\.tierLimits\s*=/)
  })
})

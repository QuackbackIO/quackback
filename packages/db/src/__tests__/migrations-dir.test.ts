import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the migrator looks for its SQL.
 *
 * Two callers have to agree: the replay-safety preflight reads the files to
 * decide whether a migration is safe to run a second time, and drizzle's
 * migrator executes them. A run that executes files the plan never read is the
 * failure this constant exists to prevent, so both take it from here.
 *
 * The default resolves from the module's own location rather than the caller's
 * cwd, which is right for a checkout and wrong for a bundle: `bun build
 * --bundle` collapses every module into one file, so `import.meta.url` becomes
 * the bundle's path and `../drizzle` lands a directory ABOVE the SQL. That is
 * exactly the layout the production image ships (`/app/fleet-migrator.mjs`
 * beside `/app/drizzle`), and it failed on the first file read: every workspace
 * migration in the fleet, stopped by a path.
 *
 * Hence the override. Both branches are pinned here because deleting either one
 * breaks a real deployment shape and neither breaks the other's.
 */
describe('MIGRATIONS_DIR', () => {
  const original = process.env['MIGRATIONS_FOLDER']

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (original === undefined) delete process.env['MIGRATIONS_FOLDER']
    else process.env['MIGRATIONS_FOLDER'] = original
    vi.resetModules()
  })

  it('takes MIGRATIONS_FOLDER when it is set, which is what makes the image work', async () => {
    process.env['MIGRATIONS_FOLDER'] = '/app/drizzle'
    const { MIGRATIONS_DIR } = await import('../schema-version')
    expect(MIGRATIONS_DIR).toBe('/app/drizzle')
  })

  it('ignores a blank override rather than resolving SQL against the filesystem root', async () => {
    process.env['MIGRATIONS_FOLDER'] = '   '
    const { MIGRATIONS_DIR } = await import('../schema-version')
    expect(MIGRATIONS_DIR).toMatch(/packages[/\\]db[/\\]drizzle$/)
  })

  it('falls back to the SQL beside this module, and that SQL is really there', async () => {
    delete process.env['MIGRATIONS_FOLDER']
    const { MIGRATIONS_DIR, latestBundledVersion, tagForVersion } =
      await import('../schema-version')
    expect(MIGRATIONS_DIR).toMatch(/packages[/\\]db[/\\]drizzle$/)

    // The fallback is only worth having if it points at readable files: a path
    // that merely looks right is the same outage as a path that looks wrong.
    const tag = tagForVersion(latestBundledVersion())
    expect(tag).toBeTruthy()
    expect(existsSync(join(MIGRATIONS_DIR, `${tag}.sql`))).toBe(true)
  })
})

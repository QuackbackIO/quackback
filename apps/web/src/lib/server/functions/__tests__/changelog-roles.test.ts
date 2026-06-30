/**
 * Changelog server-fn + REST role contract.
 *
 * Members create + edit changelog entries; only admins delete them.
 * The REST endpoints under /api/v1/changelog must match the server-fn
 * gates so the same operator can use either surface consistently.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..')
const fnSource = readFileSync(join(here, '..', 'changelog.ts'), 'utf-8')
const restIndexSource = readFileSync(
  join(repoRoot, 'apps/web/src/routes/api/v1/changelog/index.ts'),
  'utf-8'
)
const restEntrySource = readFileSync(
  join(repoRoot, 'apps/web/src/routes/api/v1/changelog/$entryId.ts'),
  'utf-8'
)

function fnPermissionFor(fnName: string): string | null {
  const re = new RegExp(
    `export const ${fnName}\\s*=\\s*createServerFn[\\s\\S]*?requireAuth\\(\\{\\s*permission:\\s*PERMISSIONS\\.(\\w+)`
  )
  return fnSource.match(re)?.[1] ?? null
}

/** Match the FIRST withApiKeyAuth role string within the given method handler. */
function restRoleFor(source: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE'): string | null {
  const re = new RegExp(
    `${method}:\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?withApiKeyAuth\\([^,]+,\\s*\\{\\s*role:\\s*['"]([^'"]+)['"]`
  )
  const m = source.match(re)
  return m ? m[1] : null
}

describe('changelog server-fn permissions', () => {
  it.each([['createChangelogFn'], ['updateChangelogFn'], ['deleteChangelogFn']])(
    '%s gates on changelog.manage',
    (fnName) => {
      expect(fnPermissionFor(fnName)).toBe('CHANGELOG_MANAGE')
    }
  )
})

describe('changelog REST roles', () => {
  it('POST /api/v1/changelog (create) allows team', () => {
    expect(restRoleFor(restIndexSource, 'POST')).toBe('team')
  })

  it('PATCH /api/v1/changelog/$entryId (update) allows team', () => {
    expect(restRoleFor(restEntrySource, 'PATCH')).toBe('team')
  })

  it('DELETE /api/v1/changelog/$entryId allows team (soft-delete)', () => {
    expect(restRoleFor(restEntrySource, 'DELETE')).toBe('team')
  })
})

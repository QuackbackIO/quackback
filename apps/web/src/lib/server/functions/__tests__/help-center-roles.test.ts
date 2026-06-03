/**
 * Help-center server-fn role contract.
 *
 * Members create + edit articles; only admins delete articles and
 * manage category structure. This matches the REST contract
 * (api/v1/help-center/*) so an admin UI that allows members to
 * write articles doesn't dead-end against a more-restrictive
 * server-fn gate.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'help-center.ts'), 'utf-8')

/** Extract the `roles: [...]` array following the named server-fn's handler. */
function roleListFor(fnName: string): string[] | null {
  const re = new RegExp(
    `export const ${fnName}\\s*=\\s*createServerFn[\\s\\S]*?requireAuth\\(\\{\\s*roles:\\s*\\[([^\\]]+)\\]`
  )
  const m = source.match(re)
  if (!m) return null
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean)
}

describe('help-center server-fn roles', () => {
  describe('article CRUD — members allowed (all soft-delete-based)', () => {
    it.each([
      ['createArticleFn'],
      ['updateArticleFn'],
      ['publishArticleFn'],
      ['unpublishArticleFn'],
      ['deleteArticleFn'],
    ])('%s allows admin + member', (fnName) => {
      const roles = roleListFor(fnName)
      expect(roles, `${fnName} should be present with a requireAuth gate`).not.toBeNull()
      expect(roles).toEqual(expect.arrayContaining(['admin', 'member']))
    })
  })

  describe('category structure — admin only (categories are organizational)', () => {
    it.each([['createCategoryFn'], ['updateCategoryFn'], ['deleteCategoryFn']])(
      '%s is admin-only',
      (fnName) => {
        const roles = roleListFor(fnName)
        expect(roles, `${fnName} should be present with a requireAuth gate`).not.toBeNull()
        expect(roles).toEqual(['admin'])
      }
    )
  })
})

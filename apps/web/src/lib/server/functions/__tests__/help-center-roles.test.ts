/**
 * Help-center server-fn permission contract.
 *
 * All help-center writes (articles + category structure) gate on the single
 * help_center.manage permission. The old article-vs-category role split is gone:
 * the permission is the one bar (the role inconsistency disappeared in the
 * permission conversion).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'help-center.ts'), 'utf-8')

/** Extract the PERMISSIONS key the named server-fn gates on. */
function permissionFor(fnName: string): string | null {
  const re = new RegExp(
    `export const ${fnName}\\s*=\\s*createServerFn[\\s\\S]*?requireAuth\\(\\{\\s*permission:\\s*PERMISSIONS\\.(\\w+)`
  )
  return source.match(re)?.[1] ?? null
}

describe('help-center server-fn permissions', () => {
  it.each([
    ['createArticleFn'],
    ['updateArticleFn'],
    ['publishArticleFn'],
    ['unpublishArticleFn'],
    ['deleteArticleFn'],
    ['createCategoryFn'],
    ['updateCategoryFn'],
    ['deleteCategoryFn'],
  ])('%s gates on help_center.manage', (fnName) => {
    expect(permissionFor(fnName), `${fnName} should have a permission gate`).toBe(
      'HELP_CENTER_MANAGE'
    )
  })
})

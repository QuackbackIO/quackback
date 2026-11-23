/**
 * Every REST route reads its body with `readJsonBody`.
 *
 * A bare `request.json()` throws a SyntaxError on a body that is not JSON,
 * which no route maps, so the caller gets a 500 for their own mistake.
 * `readJsonBody` turns it into a 400. This guard fails on any bare call under
 * `routes/api/v1`.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('REST request bodies', () => {
  it('are read with readJsonBody, never a bare request.json()', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => /\brequest\.json\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))

    expect(offenders).toEqual([])
  })
})

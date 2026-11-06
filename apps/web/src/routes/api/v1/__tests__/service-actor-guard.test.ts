/**
 * Every REST route must build its API key actor with `serviceActorFromApiAuth`.
 *
 * An inline `{ principalType: 'service', ... }` literal drops the key's
 * `scopePrincipalId`, which silently turns a personal key workspace-wide in
 * the ticket and conversation filters. This guard fails on any such literal
 * under `routes/api/v1`.
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

describe('REST API key actors', () => {
  it('are always built by serviceActorFromApiAuth, never an inline service literal', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => /principalType:\s*'service'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))

    expect(offenders).toEqual([])
  })
})

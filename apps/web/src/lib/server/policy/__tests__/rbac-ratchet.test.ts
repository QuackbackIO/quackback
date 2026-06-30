import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Conversion ratchet (Phase C): the count of remaining legacy
// `requireAuth({ roles })` gates must only ever decrease as each domain batch
// converts to `requireAuth({ permission })`. Lower MAX after every conversion
// PR; at the Phase C completion gate it reaches 0 and the `roles` option is
// deleted outright (a compile error replaces this runtime ratchet).
const MAX_LEGACY_ROLE_GATES = 61 // post-C5 (members/people/segments/attributes converted)

const SRC = join(__dirname, '../../../..') // apps/web/src

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      walk(p, acc)
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.')) {
      acc.push(p)
    }
  }
  return acc
}

function countLegacyRoleGates(): number {
  let n = 0
  for (const file of walk(SRC)) {
    const matches = readFileSync(file, 'utf8').match(/requireAuth\(\{\s*roles:/g)
    if (matches) n += matches.length
  }
  return n
}

describe('RBAC conversion ratchet', () => {
  it('legacy requireAuth({ roles }) gate count only decreases', () => {
    expect(countLegacyRoleGates()).toBeLessThanOrEqual(MAX_LEGACY_ROLE_GATES)
  })
})

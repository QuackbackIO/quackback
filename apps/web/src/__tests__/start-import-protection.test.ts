import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('start.ts import protection', () => {
  it('does not pull the email ledger sink into the client start entry', () => {
    const src = readFileSync(join(here, '../start.ts'), 'utf8')
    expect(src).not.toMatch(/email-log\.sink/)
    expect(src).not.toMatch(/@\/lib\/server\/db\b/)
  })
})

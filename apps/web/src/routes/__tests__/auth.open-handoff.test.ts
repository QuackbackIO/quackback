import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('open handoff consume path', () => {
  it('consumes on the incoming request, not a server-fn RPC', () => {
    const src = readFileSync(join(here, '../auth.open-handoff.tsx'), 'utf8')
    expect(src).not.toMatch(/createServerFn/)
    expect(src).toMatch(/handoff-cookies\.server/)
  })

  it('keeps rename transfer on the incoming request too', () => {
    const src = readFileSync(join(here, '../auth.origin-transfer.tsx'), 'utf8')
    expect(src).not.toMatch(/createServerFn/)
    expect(src).toMatch(/handoff-cookies\.server/)
  })
})

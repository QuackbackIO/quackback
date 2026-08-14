import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

function assertIncomingRequestConsume(src: string) {
  expect(src).not.toMatch(/\bcreateServerFn\b/)
  expect(src).not.toMatch(/handoff-cookies/)
  expect(src).not.toMatch(/throw redirect/)
  expect(src).toMatch(/createServerOnlyFn/)
  expect(src).toMatch(/getRequestHeaders/)
  expect(src).toMatch(/setResponseHeader/)
  expect(src).toMatch(/location\.replace/)
}

describe('open handoff consume path', () => {
  it('consumes on the incoming request, not a server-fn RPC', () => {
    assertIncomingRequestConsume(readFileSync(join(here, '../auth.open-handoff.tsx'), 'utf8'))
  })

  it('keeps rename transfer on the incoming request too', () => {
    assertIncomingRequestConsume(readFileSync(join(here, '../auth.origin-transfer.tsx'), 'utf8'))
  })
})

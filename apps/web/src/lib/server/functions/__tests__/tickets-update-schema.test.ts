import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ticketsSource = readFileSync(resolve(__dirname, '../tickets.ts'), 'utf8')

function updateTicketFnSource() {
  const match = ticketsSource.match(
    /export const updateTicketFn = createServerFn\([\s\S]*?\/\/ ---------- assign ----------/
  )
  if (!match) throw new Error('updateTicketFn block not found')
  return match[0]
}

describe('updateTicketFn input schema', () => {
  it('keeps description fields in the admin update mutation validator', () => {
    const source = updateTicketFnSource()

    expect(source).toContain('descriptionJson: tiptapDocSchema.nullable().optional()')
    expect(source).toContain('descriptionText: z.string().max(100_000).nullable().optional()')
  })
})

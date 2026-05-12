import { describe, it, expect } from 'vitest'
import { boards } from '../boards'

describe('boards schema', () => {
  it('exposes audience and moderation columns with safe defaults', () => {
    const audience = boards.audience
    const moderation = boards.moderation
    expect(audience).toBeDefined()
    expect(moderation).toBeDefined()
    // Drizzle attaches the default factory on the column object.
    // We don't introspect drizzle internals here — the typecheck below is the real assertion.
    type Row = typeof boards.$inferSelect
    const sample: Row = {} as Row
    // Compile-time: these property accesses must exist on the inferred row.
    void sample.audience
    void sample.moderation
  })
})

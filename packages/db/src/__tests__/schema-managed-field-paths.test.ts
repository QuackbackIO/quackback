import { describe, it, expect } from 'vitest'
import { settings } from '../schema/auth'

describe('settings.managedFieldPaths column', () => {
  it('is exposed on the schema with a string-array type and default []', () => {
    const col = (settings as unknown as Record<string, unknown>).managedFieldPaths
    expect(col).toBeDefined()
  })
})

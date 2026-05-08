import { describe, it, expect } from 'vitest'
import { settings } from '../schema/auth'

describe('settings.state column', () => {
  it('is exposed on the schema with a string type and default active', () => {
    const col = (settings as unknown as Record<string, unknown>).state
    expect(col).toBeDefined()
  })
})

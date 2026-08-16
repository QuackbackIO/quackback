import { describe, expect, it } from 'vitest'
import { handleSandbox } from '../sandbox'

describe('POST /api/admin/assistant/sandbox', () => {
  it('returns 410 for the removed V1 endpoint', () => {
    const response = handleSandbox()
    expect(response.status).toBe(410)
  })
})

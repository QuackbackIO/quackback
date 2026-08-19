import { describe, expect, it } from 'vitest'
import { handleSandbox } from '../sandbox'

describe('POST /api/admin/assistant/sandbox', () => {
  it('permanently redirects the removed V1 endpoint to Test agent V2', () => {
    const response = handleSandbox({
      request: new Request('http://localhost/api/admin/assistant/sandbox', { method: 'POST' }),
    })

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('http://localhost/api/admin/assistant/test')
  })
})

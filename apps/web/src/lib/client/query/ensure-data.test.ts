import { describe, expect, it } from 'vitest'
import { ensureData } from './ensure-data'

describe('ensureData', () => {
  it('returns defined server function payloads unchanged', () => {
    const payload = { ok: true }

    expect(ensureData(payload, 'payload')).toBe(payload)
  })

  it('throws a query error for missing server function payloads', () => {
    expect(() => ensureData(undefined, 'payload')).toThrow('Server returned no data for payload')
    expect(() => ensureData(null, 'payload')).toThrow('Server returned no data for payload')
  })
})

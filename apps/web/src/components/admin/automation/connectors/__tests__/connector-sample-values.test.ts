import { describe, it, expect } from 'vitest'
import { buildSampleValues } from '../connector-sample-values'
import type { ConnectorInputField } from '@/lib/server/domains/connectors/connector.types'

const inputs: ConnectorInputField[] = [
  { name: 'order_id', type: 'string', required: true },
  { name: 'qty', type: 'number' },
  { name: 'urgent', type: 'boolean' },
]

describe('buildSampleValues', () => {
  it('keeps values provided for declared inputs', () => {
    expect(buildSampleValues(inputs, { order_id: '123', qty: 5, urgent: true })).toEqual({
      order_id: '123',
      qty: 5,
      urgent: true,
    })
  })

  it('drops an empty string', () => {
    expect(buildSampleValues(inputs, { order_id: '' })).toEqual({})
  })

  it('drops a NaN number (a cleared numeric field)', () => {
    expect(buildSampleValues(inputs, { qty: Number.NaN })).toEqual({})
  })

  it('keeps zero and false, which are meaningful values', () => {
    expect(buildSampleValues(inputs, { qty: 0, urgent: false })).toEqual({ qty: 0, urgent: false })
  })

  it('ignores keys that are not declared inputs', () => {
    expect(buildSampleValues(inputs, { mystery: 'x' } as never)).toEqual({})
  })

  it('ignores undefined values', () => {
    expect(buildSampleValues(inputs, { order_id: undefined })).toEqual({})
  })
})

import { describe, it, expect } from 'vitest'
import { renderConnectorPreview } from '../connector-template-preview'

describe('renderConnectorPreview', () => {
  it('substitutes a known token', () => {
    expect(renderConnectorPreview('https://api.example.com/orders/{order_id}', { order_id: '123' })).toBe(
      'https://api.example.com/orders/123'
    )
  })

  it('substitutes dotted builtin tokens', () => {
    expect(renderConnectorPreview('{customer.email}', { 'customer.email': 'a@b.com' })).toBe(
      'a@b.com'
    )
  })

  it('renders an unresolved token as empty, mirroring the server renderer', () => {
    expect(renderConnectorPreview('{unknown}', {})).toBe('')
  })

  it('substitutes multiple occurrences of the same token', () => {
    expect(renderConnectorPreview('{id}-{id}', { id: 'x' })).toBe('x-x')
  })

  it('stringifies non-string values', () => {
    expect(renderConnectorPreview('{count}', { count: 5 })).toBe('5')
    expect(renderConnectorPreview('{flag}', { flag: true })).toBe('true')
  })
})

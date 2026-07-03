import { describe, it, expect } from 'vitest'
import {
  ticketFormFieldSchema,
  deriveFieldKey,
  uniqueFieldKey,
  findDuplicateKey,
} from '../form-field-schema'

const base = {
  key: 'order_number',
  label: 'Order number',
  type: 'text',
  required: false,
  visibleToCustomer: true,
  order: 0,
} as const

describe('ticketFormFieldSchema', () => {
  it('accepts a well-formed field', () => {
    expect(ticketFormFieldSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a key with uppercase or spaces', () => {
    expect(ticketFormFieldSchema.safeParse({ ...base, key: 'Order Number' }).success).toBe(false)
  })

  it('rejects a blank label', () => {
    expect(ticketFormFieldSchema.safeParse({ ...base, label: '   ' }).success).toBe(false)
  })

  it('requires at least one option for a select field', () => {
    expect(ticketFormFieldSchema.safeParse({ ...base, type: 'select' }).success).toBe(false)
    expect(
      ticketFormFieldSchema.safeParse({ ...base, type: 'select', options: ['Low', 'High'] }).success
    ).toBe(true)
  })
})

describe('form-field key helpers', () => {
  it('derives a lowercase, underscore-separated key', () => {
    expect(deriveFieldKey('Order Number!')).toBe('order_number')
  })

  it('suffixes to keep keys unique', () => {
    expect(uniqueFieldKey('subject', ['subject'])).toBe('subject_2')
    expect(uniqueFieldKey('subject', ['subject', 'subject_2'])).toBe('subject_3')
  })

  it('detects duplicate keys within a form', () => {
    expect(findDuplicateKey([{ key: 'a' }, { key: 'b' }, { key: 'a' }])).toBe('a')
    expect(findDuplicateKey([{ key: 'a' }, { key: 'b' }])).toBeNull()
  })
})

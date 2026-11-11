import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { sameProps } from '../same-props'

describe('sameProps', () => {
  it('takes values, arrays and plain objects by what they hold', () => {
    expect(
      sameProps({ a: 1, b: [['x', 'X']], c: { d: 'e' } }, { a: 1, b: [['x', 'X']], c: { d: 'e' } })
    ).toBe(true)
    expect(sameProps({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    expect(sameProps({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })

  it('takes functions and React elements by identity, even inside an object', () => {
    const run = () => {}
    expect(sameProps({ open: { label: 'Open', run } }, { open: { label: 'Open', run } })).toBe(true)
    expect(
      sameProps({ open: { label: 'Open', run } }, { open: { label: 'Open', run: () => {} } })
    ).toBe(false)
    const icon = createElement('svg')
    expect(sameProps({ icon }, { icon })).toBe(true)
    expect(sameProps({ icon }, { icon: createElement('svg') })).toBe(false)
  })
})

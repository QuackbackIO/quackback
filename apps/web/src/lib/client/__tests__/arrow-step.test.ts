// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { arrowStep } from '../arrow-step'

function row(dir: 'ltr' | 'rtl'): Element {
  const element = document.createElement('div')
  element.setAttribute('dir', dir)
  element.style.direction = dir
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('arrowStep', () => {
  it('steps next with Right and back with Left in a left-to-right row', () => {
    const currentTarget = row('ltr')
    expect(arrowStep({ key: 'ArrowRight', currentTarget })).toBe(1)
    expect(arrowStep({ key: 'ArrowLeft', currentTarget })).toBe(-1)
  })

  it('steps next with Left and back with Right in a right-to-left row', () => {
    const currentTarget = row('rtl')
    expect(arrowStep({ key: 'ArrowLeft', currentTarget })).toBe(1)
    expect(arrowStep({ key: 'ArrowRight', currentTarget })).toBe(-1)
  })

  it('reads Up and Down only for a vertical row, the same way in both directions', () => {
    const currentTarget = row('rtl')
    expect(arrowStep({ key: 'ArrowDown', currentTarget })).toBe(0)
    expect(arrowStep({ key: 'ArrowDown', currentTarget }, { vertical: true })).toBe(1)
    expect(arrowStep({ key: 'ArrowUp', currentTarget }, { vertical: true })).toBe(-1)
    expect(arrowStep({ key: 'Enter', currentTarget }, { vertical: true })).toBe(0)
  })
})

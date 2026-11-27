// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { HOST_SAFE_AREA_MESSAGE } from '../widget-host-safe-area'

function send(data: unknown, source: MessageEventSource | null = window.parent) {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

const inset = (side: 'top' | 'bottom' | 'left' | 'right') =>
  document.documentElement.style.getPropertyValue(`--qb-safe-${side}`)

afterEach(() => document.documentElement.removeAttribute('style'))

it('pads the widget by the insets the host page measured', () => {
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 47, bottom: 34, left: 0, right: 0 } })
  expect(inset('top')).toBe('47px')
  expect(inset('bottom')).toBe('34px')
  expect(inset('left')).toBe('0px')
  expect(inset('right')).toBe('0px')

  // A rotation sends new insets: held sideways, the notch is on one side.
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 0, bottom: 21, left: 47, right: 0 } })
  expect(inset('top')).toBe('0px')
  expect(inset('bottom')).toBe('21px')
  expect(inset('left')).toBe('47px')
  expect(inset('right')).toBe('0px')
})

it('reads a missing, negative or absurd inset as none, and caps a large one', () => {
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: -5, bottom: 'lots' } })
  expect(inset('top')).toBe('0px')
  expect(inset('bottom')).toBe('0px')
  expect(inset('left')).toBe('0px')
  expect(inset('right')).toBe('0px')
  send({
    type: HOST_SAFE_AREA_MESSAGE,
    data: { top: 5000, bottom: 33.6, left: Number.NaN, right: 5000 },
  })
  expect(inset('top')).toBe('200px')
  expect(inset('bottom')).toBe('34px')
  expect(inset('left')).toBe('0px')
  expect(inset('right')).toBe('200px')
})

it('ignores anyone but the host page', () => {
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 47, bottom: 34, left: 47, right: 0 } }, null)
  expect(inset('bottom')).toBe('')
  expect(inset('left')).toBe('')
})

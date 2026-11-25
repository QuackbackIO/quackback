// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { HOST_SAFE_AREA_MESSAGE } from '../widget-host-safe-area'

function send(data: unknown, source: MessageEventSource | null = window.parent) {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

const top = () => document.documentElement.style.getPropertyValue('--qb-safe-top')
const bottom = () => document.documentElement.style.getPropertyValue('--qb-safe-bottom')

afterEach(() => document.documentElement.removeAttribute('style'))

it('pads the widget by the insets the host page measured', () => {
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 47, bottom: 34 } })
  expect(top()).toBe('47px')
  expect(bottom()).toBe('34px')

  // A rotation sends new insets.
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 0, bottom: 21 } })
  expect(top()).toBe('0px')
  expect(bottom()).toBe('21px')
})

it('reads a missing, negative or absurd inset as none, and caps a large one', () => {
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: -5, bottom: 'lots' } })
  expect(top()).toBe('0px')
  expect(bottom()).toBe('0px')
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 5000, bottom: 33.6 } })
  expect(top()).toBe('200px')
  expect(bottom()).toBe('34px')
})

it('ignores anyone but the host page', () => {
  send({ type: HOST_SAFE_AREA_MESSAGE, data: { top: 47, bottom: 34 } }, null)
  expect(bottom()).toBe('')
})

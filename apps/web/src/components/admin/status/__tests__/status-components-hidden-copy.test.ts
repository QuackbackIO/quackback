import { describe, expect, it } from 'vitest'
import { hiddenLine } from '../status-components-view'

describe('the line over services the plan hides', () => {
  it('names the plan and says they come back', () => {
    expect(hiddenLine(2, 'Free')).toBe(
      '2 services are hidden from your status page on the Free plan. They come back when you upgrade.'
    )
    expect(hiddenLine(1, 'Free')).toBe(
      '1 service is hidden from your status page on the Free plan. It comes back when you upgrade.'
    )
  })

  it('drops the plan when it is unknown', () => {
    expect(hiddenLine(1, null)).toBe(
      '1 service is hidden from your status page. It comes back when you upgrade.'
    )
  })
})

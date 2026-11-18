import { describe, expect, it } from 'vitest'
import { planComposer } from '../submit-permission'

const features = { id: 'b1', name: 'Features' }
const bugs = { id: 'b2', name: 'Bugs' }
const mobile = { id: 'b3', name: 'Mobile' }
const permissions = {
  b1: { readOnly: false },
  b2: { readOnly: true },
  b3: { readOnly: true },
}

describe('planComposer', () => {
  it('leaves the composer alone when no board is read-only', () => {
    const plan = planComposer([features, bugs], { b1: {}, b2: {} }, undefined)
    expect(plan).toEqual({ boards: [features, bugs], readOnly: false })
  })

  it('stands down on a read-only board page', () => {
    expect(planComposer([features, bugs, mobile], permissions, 'b2').readOnly).toBe(true)
  })

  it('keeps the composer on an open board page', () => {
    expect(planComposer([features, bugs], permissions, 'b1').readOnly).toBe(false)
  })

  it('on the whole feed offers only the open boards', () => {
    const plan = planComposer([features, bugs, mobile], permissions, undefined)
    expect(plan.boards).toEqual([features])
    expect(plan.readOnly).toBe(false)
  })

  it('on the whole feed stands down only when every board is read-only', () => {
    const allClosed = { b2: { readOnly: true }, b3: { readOnly: true } }
    expect(planComposer([bugs, mobile], allClosed, undefined)).toMatchObject({
      boards: [],
      readOnly: true,
    })
  })

  it('does not stand down when there are no boards at all', () => {
    expect(planComposer([], {}, undefined).readOnly).toBe(false)
  })
})

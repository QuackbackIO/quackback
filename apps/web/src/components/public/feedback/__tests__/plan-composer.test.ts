import { describe, expect, it } from 'vitest'
import { planComposer } from '../submit-permission'

const features = { id: 'b1', name: 'Features' }
const bugs = { id: 'b2', name: 'Bugs' }
const mobile = { id: 'b3', name: 'Mobile' }
const permissions = {
  b1: { readOnly: false },
  b2: { readOnly: true, shareBoardId: 'b1' },
  b3: { readOnly: true, shareBoardId: 'b1' },
}

describe('planComposer', () => {
  it('leaves the composer alone when no board is read-only', () => {
    const plan = planComposer([features, bugs], { b1: {}, b2: {} }, undefined)
    expect(plan).toEqual({ boards: [features, bugs], readOnly: false, shareBoard: null })
  })

  it('stands down on a read-only board page and points at the open board', () => {
    const plan = planComposer([features, bugs, mobile], permissions, 'b2')
    expect(plan.readOnly).toBe(true)
    expect(plan.shareBoard).toBe(features)
  })

  it('stands down with no link when the server named no board to post to', () => {
    const plan = planComposer(
      [features, bugs],
      { b1: { readOnly: true, shareBoardId: null }, b2: { readOnly: true, shareBoardId: null } },
      'b2'
    )
    expect(plan).toMatchObject({ readOnly: true, shareBoard: null })
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
      shareBoard: null,
    })
  })

  it('does not stand down when there are no boards at all', () => {
    expect(planComposer([], {}, undefined).readOnly).toBe(false)
  })
})

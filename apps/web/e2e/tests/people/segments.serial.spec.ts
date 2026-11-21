/**
 * Segment journeys that touch every dynamic segment in the workspace, so no
 * other test may be evaluating segments meanwhile.
 *
 * Journeys: PPL-G-50
 */
import { test, expect } from '../../support/fixtures'
import {
  createSegment,
  membersOf,
  mustCall,
  personApi,
  portalUserRow,
} from '../../product/people-segments'

test(
  'PPL-G-50 evaluate every dynamic segment at once',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const person = await portalUserRow(marker)
    const seg = await createSegment(admin, {
      name: `Everyone ${marker}`,
      type: 'dynamic',
      conditions: [{ attribute: 'email', operator: 'eq', value: person.email }],
    })
    const manual = await createSegment(admin, { name: `Hand ${marker}`, type: 'manual' })

    const results = await mustCall<Array<{ segmentId: string; added: number; removed: number }>>(
      admin,
      'evaluateAllSegmentsFn'
    )
    expect(results.find((r) => r.segmentId === seg.id)).toEqual({
      segmentId: seg.id,
      added: 1,
      removed: 0,
    })
    expect(
      results.find((r) => r.segmentId === manual.id),
      'manual segments are skipped'
    ).toBe(undefined)
    expect(await membersOf(seg.id)).toEqual([
      { principalId: person.principalId, addedBy: 'dynamic' },
    ])
    await admin.dispose()
  }
)

import { describe, expect, it } from 'vitest'
import {
  noEtaRoadmapBucket,
  parseRoadmapDateBucket,
  roadmapBucketWriteback,
  roadmapDateBucketFor,
  roadmapDateBucketsBetween,
} from '../roadmap-config'

describe('roadmap date buckets', () => {
  it.each([
    ['monthly' as const, '2026-09', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ['quarterly' as const, '2026-Q3', '2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ['semiannual' as const, '2026-H2', '2026-07-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
  ])('uses UTC half-open %s boundaries', (frequency, id, start, end) => {
    const bucket = roadmapDateBucketFor(new Date('2026-09-30T23:59:59.999Z'), frequency)
    expect(bucket).toMatchObject({ id, start, end })
    expect(parseRoadmapDateBucket(id, frequency)).toEqual(bucket)
  })

  it('targets the final month for quarter and half-year writeback', () => {
    expect(roadmapBucketWriteback(roadmapDateBucketFor(new Date('2026-07-15'), 'monthly'))).toBe(
      '2026-07-01T00:00:00.000Z'
    )
    expect(roadmapBucketWriteback(roadmapDateBucketFor(new Date('2026-07-15'), 'quarterly'))).toBe(
      '2026-09-01T00:00:00.000Z'
    )
    expect(roadmapBucketWriteback(roadmapDateBucketFor(new Date('2026-07-15'), 'semiannual'))).toBe(
      '2026-12-01T00:00:00.000Z'
    )
  })

  it('keeps No ETA visible and final', () => {
    const buckets = roadmapDateBucketsBetween(
      'quarterly',
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T23:59:59.999Z',
      new Date('2026-07-14T00:00:00.000Z')
    )
    expect(buckets.map((bucket) => bucket.id)).toEqual([
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
      'no-eta',
    ])
    expect(roadmapBucketWriteback(noEtaRoadmapBucket())).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  noEtaRoadmapBucket,
  parseRoadmapDateBucket,
  roadmapBucketWriteback,
  roadmapDateBucketFor,
  roadmapDateBucketsBetween,
  roadmapToSelect,
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

  it.each([
    ['monthly' as const, 'Sep 2026'],
    ['quarterly' as const, 'Q3 2026'],
    ['semiannual' as const, 'H2 2026'],
  ])('RMP-E-07 labels a %s bucket as %s', (frequency, label) => {
    expect(roadmapDateBucketFor(new Date('2026-09-30T23:59:59.999Z'), frequency).label).toBe(label)
    expect(noEtaRoadmapBucket().label).toBe('No ETA')
  })

  it('RMP-E-07 widens the range to include the current period when every ETA is in the past', () => {
    const buckets = roadmapDateBucketsBetween(
      'monthly',
      '2026-01-20T00:00:00.000Z',
      '2026-02-05T00:00:00.000Z',
      new Date('2026-04-10T00:00:00.000Z')
    )
    expect(buckets.map((bucket) => bucket.id)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      'no-eta',
    ])
  })

  it('RMP-E-07 starts at the current period when every ETA is in the future', () => {
    const buckets = roadmapDateBucketsBetween(
      'semiannual',
      '2027-08-01T00:00:00.000Z',
      '2027-09-01T00:00:00.000Z',
      new Date('2026-03-01T00:00:00.000Z')
    )
    expect(buckets.map((bucket) => bucket.id)).toEqual([
      '2026-H1',
      '2026-H2',
      '2027-H1',
      '2027-H2',
      'no-eta',
    ])
  })

  it('RMP-E-07 shows just the current period and No ETA when no post has an ETA', () => {
    const buckets = roadmapDateBucketsBetween(
      'quarterly',
      null,
      null,
      new Date('2026-11-20T00:00:00.000Z')
    )
    expect(buckets.map((bucket) => bucket.id)).toEqual(['2026-Q4', 'no-eta'])
  })
})

describe('roadmapToSelect', () => {
  const roadmaps = [{ id: 'roadmap_a' }, { id: 'roadmap_b' }, { id: 'roadmap_c' }]

  it('keeps a requested roadmap the viewer can see', () => {
    expect(roadmapToSelect(roadmaps, 'roadmap_b')?.id).toBe('roadmap_b')
  })

  it('RMP-P-05 falls back to the first roadmap when the requested one is hidden or deleted', () => {
    expect(roadmapToSelect(roadmaps, 'roadmap_gone')?.id).toBe('roadmap_a')
  })

  it('picks the first roadmap when none is requested', () => {
    expect(roadmapToSelect(roadmaps, null)?.id).toBe('roadmap_a')
  })

  it('RMP-A-16 never picks the roadmap being deleted', () => {
    expect(roadmapToSelect(roadmaps, null, { excluding: 'roadmap_a' })?.id).toBe('roadmap_b')
    expect(roadmapToSelect([{ id: 'roadmap_a' }], null, { excluding: 'roadmap_a' })).toBeUndefined()
  })
})

import { z } from 'zod'
import { boardIdSchema, postStatusIdSchema, segmentIdSchema, tagIdSchema } from '@quackback/ids/zod'
import type { BoardId, PostStatusId, PostTagId, SegmentId } from '@quackback/ids'

export const roadmapTypeSchema = z.enum(['column', 'date'])
export const roadmapDateSourceSchema = z.literal('eta')
export const roadmapFrequencySchema = z.enum(['monthly', 'quarterly', 'semiannual'])
export const roadmapVisibilitySchema = z.enum(['public', 'team', 'segment'])

function compatibleIdSchema(schema: { safeParse: (value: unknown) => { success: boolean } }) {
  return z.string().refine((value) => schema.safeParse(value).success, 'Invalid TypeID')
}

export const boardIdInputSchema = compatibleIdSchema(boardIdSchema)
export const postStatusIdInputSchema = compatibleIdSchema(postStatusIdSchema)
export const segmentIdInputSchema = compatibleIdSchema(segmentIdSchema)
export const tagIdInputSchema = compatibleIdSchema(tagIdSchema)

export const roadmapBaseFilterSchema = z
  .object({
    statusIds: z.array(postStatusIdInputSchema).optional(),
    boardIds: z.array(boardIdInputSchema).optional(),
    tagIds: z.array(tagIdInputSchema).optional(),
    segmentIds: z.array(segmentIdInputSchema).optional(),
  })
  .strict()

export interface RoadmapBaseFilter {
  statusIds?: PostStatusId[]
  boardIds?: BoardId[]
  tagIds?: PostTagId[]
  segmentIds?: SegmentId[]
}

export type RoadmapType = z.infer<typeof roadmapTypeSchema>
export type RoadmapFrequency = z.infer<typeof roadmapFrequencySchema>
export type RoadmapVisibility = z.infer<typeof roadmapVisibilitySchema>

export interface RoadmapDateBucket {
  id: string
  label: string
  start: string | null
  end: string | null
  targetMonth: string | null
  noEta: boolean
}

export const NO_ETA_BUCKET_ID = 'no-eta'

function startOfPeriod(date: Date, frequency: RoadmapFrequency): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const startMonth =
    frequency === 'monthly'
      ? month
      : frequency === 'quarterly'
        ? Math.floor(month / 3) * 3
        : Math.floor(month / 6) * 6
  return new Date(Date.UTC(year, startMonth, 1))
}

function monthsPerPeriod(frequency: RoadmapFrequency): number {
  if (frequency === 'quarterly') return 3
  if (frequency === 'semiannual') return 6
  return 1
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function roadmapDateBucketFor(date: Date, frequency: RoadmapFrequency): RoadmapDateBucket {
  const start = startOfPeriod(date, frequency)
  const periodMonths = monthsPerPeriod(frequency)
  const end = addUtcMonths(start, periodMonths)
  const target = addUtcMonths(start, periodMonths - 1)
  const year = start.getUTCFullYear()
  const periodNumber = Math.floor(start.getUTCMonth() / periodMonths) + 1

  const id =
    frequency === 'monthly'
      ? monthKey(start)
      : frequency === 'quarterly'
        ? `${year}-Q${periodNumber}`
        : `${year}-H${periodNumber}`
  const label =
    frequency === 'monthly'
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(start)
      : frequency === 'quarterly'
        ? `Q${periodNumber} ${year}`
        : `H${periodNumber} ${year}`

  return {
    id,
    label,
    start: start.toISOString(),
    end: end.toISOString(),
    targetMonth: target.toISOString(),
    noEta: false,
  }
}

export function noEtaRoadmapBucket(): RoadmapDateBucket {
  return {
    id: NO_ETA_BUCKET_ID,
    label: 'No ETA',
    start: null,
    end: null,
    targetMonth: null,
    noEta: true,
  }
}

export function parseRoadmapDateBucket(
  id: string,
  frequency: RoadmapFrequency
): RoadmapDateBucket | null {
  if (id === NO_ETA_BUCKET_ID) return noEtaRoadmapBucket()

  let year: number
  let month: number
  if (frequency === 'monthly') {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(id)
    if (!match) return null
    year = Number(match[1])
    month = Number(match[2]) - 1
  } else if (frequency === 'quarterly') {
    const match = /^(\d{4})-Q([1-4])$/.exec(id)
    if (!match) return null
    year = Number(match[1])
    month = (Number(match[2]) - 1) * 3
  } else {
    const match = /^(\d{4})-H([1-2])$/.exec(id)
    if (!match) return null
    year = Number(match[1])
    month = (Number(match[2]) - 1) * 6
  }

  const bucket = roadmapDateBucketFor(new Date(Date.UTC(year, month, 1)), frequency)
  return bucket.id === id ? bucket : null
}

export function roadmapDateBucketsBetween(
  frequency: RoadmapFrequency,
  minEta: Date | string | null,
  maxEta: Date | string | null,
  now: Date = new Date()
): RoadmapDateBucket[] {
  const current = startOfPeriod(now, frequency)
  const first = minEta ? startOfPeriod(new Date(minEta), frequency) : current
  const last = maxEta ? startOfPeriod(new Date(maxEta), frequency) : current
  const start = first < current ? first : current
  const end = last > current ? last : current
  const buckets: RoadmapDateBucket[] = []

  for (
    let cursor = start;
    cursor <= end;
    cursor = addUtcMonths(cursor, monthsPerPeriod(frequency))
  ) {
    buckets.push(roadmapDateBucketFor(cursor, frequency))
  }

  buckets.push(noEtaRoadmapBucket())
  return buckets
}

export function roadmapBucketWriteback(bucket: RoadmapDateBucket): string | null {
  return bucket.targetMonth
}

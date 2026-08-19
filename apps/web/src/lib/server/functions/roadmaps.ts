import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  BoardId,
  PostStatusId,
  PostTagId,
  RoadmapColumnId,
  RoadmapId,
  SegmentId,
} from '@quackback/ids'
import { postStatusIdSchema, roadmapColumnIdSchema, roadmapIdSchema } from '@quackback/ids/zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  roadmapBaseFilterSchema,
  boardIdInputSchema,
  roadmapFrequencySchema,
  segmentIdInputSchema,
  tagIdInputSchema,
  roadmapTypeSchema,
  roadmapVisibilitySchema,
  type RoadmapBaseFilter,
} from '@/lib/shared/roadmap-config'
import {
  createRoadmap,
  createRoadmapColumn,
  deleteRoadmap,
  deleteRoadmapColumn,
  getRoadmap,
  listRoadmaps,
  reorderRoadmaps,
  updateRoadmap,
  updateRoadmapColumn,
} from '@/lib/server/domains/roadmaps/roadmap.service'
import { getRoadmapDateBuckets, getRoadmapPosts } from '@/lib/server/domains/roadmaps/roadmap.query'
import type {
  RoadmapColumnInput,
  RoadmapWithColumns,
} from '@/lib/server/domains/roadmaps/roadmap.types'
import { toIsoStringOrNull } from '@/lib/shared/utils'

const roadmapColumnInputSchema = z.object({
  id: roadmapColumnIdSchema.optional(),
  statusId: postStatusIdSchema,
  name: z.string().min(1).max(100),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().min(1).max(50),
  position: z.number().int().min(0),
})

const roadmapConfigFields = {
  type: roadmapTypeSchema.optional(),
  baseFilter: roadmapBaseFilterSchema.optional(),
  dateSource: z.literal('eta').nullable().optional(),
  frequency: roadmapFrequencySchema.nullable().optional(),
  visibility: roadmapVisibilitySchema.optional(),
  visibleSegmentIds: z.array(segmentIdInputSchema).nullable().optional(),
  columns: z.array(roadmapColumnInputSchema).optional(),
}

const createRoadmapSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  ...roadmapConfigFields,
})

const getRoadmapSchema = z.object({ id: roadmapIdSchema })

const updateRoadmapSchema = z.object({
  id: roadmapIdSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  ...roadmapConfigFields,
})

const deleteRoadmapSchema = z.object({ id: roadmapIdSchema })
const roadmapIdInputSchema = z
  .string()
  .refine((value) => roadmapIdSchema.safeParse(value).success, 'Invalid roadmap ID')

const reorderRoadmapsSchema = z.object({ roadmapIds: z.array(roadmapIdInputSchema) })

const getRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: postStatusIdSchema.optional(),
  bucketId: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  search: z.string().optional(),
  boardIds: z.array(boardIdInputSchema).optional(),
  tagIds: z.array(tagIdInputSchema).optional(),
  segmentIds: z.array(segmentIdInputSchema).optional(),
  sort: z.enum(['votes', 'newest', 'oldest']).optional(),
})

const roadmapDateBucketsSchema = z.object({ roadmapId: roadmapIdSchema })

const createRoadmapColumnSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: postStatusIdSchema,
  name: z.string().min(1).max(100),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().min(1).max(50),
  position: z.number().int().min(0).optional(),
})

const updateRoadmapColumnSchema = z.object({
  id: roadmapColumnIdSchema,
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().min(1).max(50).optional(),
  position: z.number().int().min(0).optional(),
})

const deleteRoadmapColumnSchema = z.object({ id: roadmapColumnIdSchema })

export type CreateRoadmapInput = z.infer<typeof createRoadmapSchema>
export type GetRoadmapInput = z.infer<typeof getRoadmapSchema>
export type UpdateRoadmapInput = z.infer<typeof updateRoadmapSchema>
export type DeleteRoadmapInput = z.infer<typeof deleteRoadmapSchema>
export type ReorderRoadmapsInput = z.infer<typeof reorderRoadmapsSchema>
export type GetRoadmapPostsInput = z.infer<typeof getRoadmapPostsSchema>

function serializeRoadmap(roadmap: RoadmapWithColumns) {
  return {
    id: String(roadmap.id),
    name: roadmap.name,
    slug: roadmap.slug,
    description: roadmap.description,
    type: roadmap.type,
    baseFilter: roadmap.baseFilter,
    dateSource: roadmap.dateSource,
    frequency: roadmap.frequency,
    visibility: roadmap.visibility,
    visibleSegmentIds: roadmap.visibleSegmentIds,
    position: roadmap.position,
    columns: roadmap.columns.map((column) => ({
      id: String(column.id),
      roadmapId: String(column.roadmapId),
      statusId: String(column.statusId),
      name: column.name,
      icon: column.icon,
      color: column.color,
      position: column.position,
    })),
    createdAt: roadmap.createdAt.toISOString(),
    updatedAt: roadmap.updatedAt.toISOString(),
  }
}

function parsedColumns(columns: z.infer<typeof roadmapColumnInputSchema>[] | undefined) {
  return columns as RoadmapColumnInput[] | undefined
}

export const fetchRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
  return (await listRoadmaps()).map(serializeRoadmap)
})

export const fetchRoadmap = createServerFn({ method: 'GET' })
  .validator(getRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    return serializeRoadmap(await getRoadmap(data.id as RoadmapId))
  })

export const createRoadmapFn = createServerFn({ method: 'POST' })
  .validator(createRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    return serializeRoadmap(
      await createRoadmap({
        ...data,
        baseFilter: data.baseFilter as RoadmapBaseFilter | undefined,
        visibleSegmentIds: data.visibleSegmentIds as SegmentId[] | null | undefined,
        columns: parsedColumns(data.columns),
      })
    )
  })

export const updateRoadmapFn = createServerFn({ method: 'POST' })
  .validator(updateRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    return serializeRoadmap(
      await updateRoadmap(data.id as RoadmapId, {
        name: data.name,
        description: data.description,
        type: data.type,
        baseFilter: data.baseFilter as RoadmapBaseFilter | undefined,
        dateSource: data.dateSource,
        frequency: data.frequency,
        visibility: data.visibility,
        visibleSegmentIds: data.visibleSegmentIds as SegmentId[] | null | undefined,
        columns: parsedColumns(data.columns),
      })
    )
  })

export const deleteRoadmapFn = createServerFn({ method: 'POST' })
  .validator(deleteRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    await deleteRoadmap(data.id as RoadmapId)
    return { id: data.id }
  })

export const createRoadmapColumnFn = createServerFn({ method: 'POST' })
  .validator(createRoadmapColumnSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    const column = await createRoadmapColumn({
      ...data,
      roadmapId: data.roadmapId as RoadmapId,
      statusId: data.statusId as PostStatusId,
    })
    return { ...column, id: String(column.id), roadmapId: String(column.roadmapId) }
  })

export const updateRoadmapColumnFn = createServerFn({ method: 'POST' })
  .validator(updateRoadmapColumnSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    const column = await updateRoadmapColumn(data.id as RoadmapColumnId, data)
    return { ...column, id: String(column.id), roadmapId: String(column.roadmapId) }
  })

export const deleteRoadmapColumnFn = createServerFn({ method: 'POST' })
  .validator(deleteRoadmapColumnSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    await deleteRoadmapColumn(data.id as RoadmapColumnId)
    return { id: data.id }
  })

export const reorderRoadmapsFn = createServerFn({ method: 'POST' })
  .validator(reorderRoadmapsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    await reorderRoadmaps(data.roadmapIds as RoadmapId[])
    return { success: true }
  })

export const getRoadmapPostsFn = createServerFn({ method: 'GET' })
  .validator(getRoadmapPostsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    const result = await getRoadmapPosts(data.roadmapId as RoadmapId, {
      statusId: data.statusId as PostStatusId | undefined,
      bucketId: data.bucketId,
      limit: data.limit,
      offset: data.offset,
      search: data.search,
      boardIds: data.boardIds as BoardId[] | undefined,
      tagIds: data.tagIds as PostTagId[] | undefined,
      segmentIds: data.segmentIds as SegmentId[] | undefined,
      sort: data.sort,
    })
    return {
      ...result,
      items: result.items.map((item) => ({
        id: String(item.id),
        title: item.title,
        voteCount: item.voteCount,
        statusId: item.statusId ? String(item.statusId) : null,
        eta: toIsoStringOrNull(item.eta),
        board: { id: String(item.board.id), name: item.board.name, slug: item.board.slug },
      })),
    }
  })

export const getRoadmapDateBucketsFn = createServerFn({ method: 'GET' })
  .validator(roadmapDateBucketsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ROADMAP_MANAGE })
    return getRoadmapDateBuckets(data.roadmapId as RoadmapId)
  })

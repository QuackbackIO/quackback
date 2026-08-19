import {
  db,
  eq,
  and,
  isNull,
  inArray,
  asc,
  sql,
  roadmaps,
  roadmapColumns,
  postStatuses,
  type Roadmap,
  type RoadmapColumn,
  type Transaction,
} from '@/lib/server/db'
import type { RoadmapId, RoadmapColumnId } from '@quackback/ids'
import { positionCaseSql } from '@/lib/server/utils'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { roadmapBaseFilterSchema } from '@/lib/shared/roadmap-config'
import { roadmapViewFilter, type Actor, ANONYMOUS_ACTOR } from '@/lib/server/policy'
import type {
  CreateRoadmapColumnInput,
  CreateRoadmapInput,
  RoadmapColumnInput,
  RoadmapWithColumns,
  UpdateRoadmapColumnInput,
  UpdateRoadmapInput,
} from './roadmap.types'

function validateColumns(columns: RoadmapColumnInput[]): void {
  const statuses = new Set<string>()
  for (const column of columns) {
    if (!column.name.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Column name is required')
    }
    if (!column.color.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Column color is required')
    }
    if (statuses.has(column.statusId)) {
      throw new ValidationError('VALIDATION_ERROR', 'Each status can appear only once in a roadmap')
    }
    statuses.add(column.statusId)
  }
}

function validateConfig(input: CreateRoadmapInput | UpdateRoadmapInput, current?: Roadmap): void {
  const type = input.type ?? current?.type ?? 'column'
  const frequency =
    input.frequency !== undefined
      ? input.frequency
      : input.type !== undefined
        ? type === 'date'
          ? (current?.frequency ?? 'monthly')
          : null
        : current?.frequency
  const dateSource =
    input.dateSource !== undefined
      ? input.dateSource
      : input.type !== undefined
        ? type === 'date'
          ? 'eta'
          : null
        : type === 'date'
          ? (current?.dateSource ?? 'eta')
          : current?.dateSource
  const visibility = input.visibility ?? current?.visibility ?? 'public'
  const visibleSegmentIds =
    input.visibleSegmentIds !== undefined ? input.visibleSegmentIds : current?.visibleSegmentIds

  if (!roadmapBaseFilterSchema.safeParse(input.baseFilter ?? current?.baseFilter ?? {}).success) {
    throw new ValidationError('VALIDATION_ERROR', 'Invalid roadmap base filter')
  }
  if (type === 'date' && (dateSource !== 'eta' || !frequency)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Date roadmaps require ETA as the date source and a frequency'
    )
  }
  if (type === 'column' && (dateSource != null || frequency != null)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Column roadmaps cannot have a date source or frequency'
    )
  }
  if (visibility === 'segment' && !visibleSegmentIds?.length) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Segment-visible roadmaps require at least one segment'
    )
  }
  if (input.columns) validateColumns(input.columns)
}

async function defaultColumns(executor: Pick<typeof db, 'select'>): Promise<RoadmapColumnInput[]> {
  const statuses = await executor
    .select({
      statusId: postStatuses.id,
      name: postStatuses.name,
      color: postStatuses.color,
    })
    .from(postStatuses)
    .where(and(eq(postStatuses.showOnRoadmap, true), isNull(postStatuses.deletedAt)))
    .orderBy(asc(postStatuses.category), asc(postStatuses.position))

  return statuses.map((status, position) => ({ ...status, icon: null, position }))
}

async function replaceColumns(
  tx: Transaction,
  roadmapId: RoadmapId,
  columns: RoadmapColumnInput[]
): Promise<void> {
  validateColumns(columns)
  await tx.delete(roadmapColumns).where(eq(roadmapColumns.roadmapId, roadmapId))
  if (!columns.length) return
  await tx.insert(roadmapColumns).values(
    columns.map((column, index) => ({
      id: column.id,
      roadmapId,
      statusId: column.statusId,
      name: column.name.trim(),
      icon: column.icon?.trim() || null,
      color: column.color.trim(),
      position: column.position ?? index,
    }))
  )
}

export async function createRoadmap(input: CreateRoadmapInput): Promise<RoadmapWithColumns> {
  if (!input.name?.trim()) throw new ValidationError('VALIDATION_ERROR', 'Name is required')
  if (!input.slug?.trim()) throw new ValidationError('VALIDATION_ERROR', 'Slug is required')
  if (input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Slug must contain only lowercase letters, numbers, and hyphens'
    )
  }
  validateConfig(input)

  const existing = await db.query.roadmaps.findFirst({ where: eq(roadmaps.slug, input.slug) })
  if (existing) {
    throw new ConflictError('DUPLICATE_SLUG', `A roadmap with slug "${input.slug}" already exists`)
  }

  const positionResult = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${roadmaps.position}), -1)` })
    .from(roadmaps)
  const position = (positionResult[0]?.maxPosition ?? -1) + 1
  const type = input.type ?? 'column'
  const visibility = input.visibility ?? 'public'

  const roadmap = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(roadmaps)
      .values({
        name: input.name.trim(),
        slug: input.slug.trim(),
        description: input.description?.trim() || null,
        type,
        baseFilter: input.baseFilter ?? {},
        dateSource: type === 'date' ? 'eta' : null,
        frequency: type === 'date' ? (input.frequency ?? 'monthly') : null,
        visibility,
        visibleSegmentIds: visibility === 'segment' ? input.visibleSegmentIds : null,
        position,
      })
      .returning()

    if (type === 'column') {
      await replaceColumns(tx, created.id, input.columns ?? (await defaultColumns(tx)))
    }
    return created
  })

  return getRoadmap(roadmap.id)
}

export async function updateRoadmap(
  id: RoadmapId,
  input: UpdateRoadmapInput
): Promise<RoadmapWithColumns> {
  const current = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, id), isNull(roadmaps.deletedAt)),
  })
  if (!current) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
  }
  if (input.name && input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }
  validateConfig(input, current)

  const type = input.type ?? current.type
  const visibility = input.visibility ?? current.visibility
  await db.transaction(async (tx) => {
    await tx
      .update(roadmaps)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.type !== undefined ? { type } : {}),
        ...(input.baseFilter !== undefined ? { baseFilter: input.baseFilter } : {}),
        ...(input.type !== undefined || input.dateSource !== undefined
          ? { dateSource: type === 'date' ? 'eta' : null }
          : {}),
        ...(input.type !== undefined || input.frequency !== undefined
          ? {
              frequency:
                type === 'date' ? (input.frequency ?? current.frequency ?? 'monthly') : null,
            }
          : {}),
        ...(input.visibility !== undefined ? { visibility } : {}),
        ...(input.visibility !== undefined || input.visibleSegmentIds !== undefined
          ? {
              visibleSegmentIds:
                visibility === 'segment'
                  ? (input.visibleSegmentIds ?? current.visibleSegmentIds)
                  : null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(roadmaps.id, id))

    if (type === 'date') {
      await tx.delete(roadmapColumns).where(eq(roadmapColumns.roadmapId, id))
    } else if (input.columns) {
      await replaceColumns(tx, id, input.columns)
    }
  })

  return getRoadmap(id)
}

export async function deleteRoadmap(id: RoadmapId): Promise<void> {
  const result = await db
    .update(roadmaps)
    .set({ deletedAt: new Date() })
    .where(and(eq(roadmaps.id, id), isNull(roadmaps.deletedAt)))
    .returning()
  if (!result.length) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }
}

export async function getRoadmap(id: RoadmapId): Promise<RoadmapWithColumns> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, id), isNull(roadmaps.deletedAt)),
    with: { columns: { orderBy: [asc(roadmapColumns.position)] } },
  })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }
  return roadmap
}

export async function getRoadmapBySlug(slug: string): Promise<RoadmapWithColumns> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.slug, slug), isNull(roadmaps.deletedAt)),
    with: { columns: { orderBy: [asc(roadmapColumns.position)] } },
  })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with slug "${slug}" not found`)
  }
  return roadmap
}

export async function listRoadmaps(): Promise<RoadmapWithColumns[]> {
  return db.query.roadmaps.findMany({
    where: isNull(roadmaps.deletedAt),
    orderBy: [asc(roadmaps.position)],
    with: { columns: { orderBy: [asc(roadmapColumns.position)] } },
  })
}

export async function listPublicRoadmaps(
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapWithColumns[]> {
  return db.query.roadmaps.findMany({
    where: roadmapViewFilter(actor),
    orderBy: [asc(roadmaps.position)],
    with: { columns: { orderBy: [asc(roadmapColumns.position)] } },
  })
}

export async function reorderRoadmaps(roadmapIds: RoadmapId[]): Promise<void> {
  if (!roadmapIds.length) return
  await db
    .update(roadmaps)
    .set({ position: positionCaseSql(roadmaps.id, roadmapIds) })
    .where(inArray(roadmaps.id, roadmapIds))
}

export async function createRoadmapColumn(input: CreateRoadmapColumnInput): Promise<RoadmapColumn> {
  const roadmap = await getRoadmap(input.roadmapId)
  if (roadmap.type !== 'column') {
    throw new ValidationError('VALIDATION_ERROR', 'Date roadmaps cannot have status columns')
  }
  const [column] = await db
    .insert(roadmapColumns)
    .values({
      roadmapId: input.roadmapId,
      statusId: input.statusId,
      name: input.name.trim(),
      icon: input.icon?.trim() || null,
      color: input.color.trim(),
      position: input.position ?? roadmap.columns.length,
    })
    .returning()
  return column
}

export async function updateRoadmapColumn(
  id: RoadmapColumnId,
  input: UpdateRoadmapColumnInput
): Promise<RoadmapColumn> {
  const [column] = await db
    .update(roadmapColumns)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.icon !== undefined ? { icon: input.icon?.trim() || null } : {}),
      ...(input.color !== undefined ? { color: input.color.trim() } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      updatedAt: new Date(),
    })
    .where(eq(roadmapColumns.id, id))
    .returning()
  if (!column) {
    throw new NotFoundError('ROADMAP_COLUMN_NOT_FOUND', `Roadmap column ${id} not found`)
  }
  return column
}

export async function deleteRoadmapColumn(id: RoadmapColumnId): Promise<void> {
  const deleted = await db.delete(roadmapColumns).where(eq(roadmapColumns.id, id)).returning()
  if (!deleted.length) {
    throw new NotFoundError('ROADMAP_COLUMN_NOT_FOUND', `Roadmap column ${id} not found`)
  }
}

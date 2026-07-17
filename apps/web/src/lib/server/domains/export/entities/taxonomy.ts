/**
 * Taxonomy exporters (boards, statuses, tags) — small lookup tables every
 * other file references by slug/name.
 */
import { db, boards, postStatuses, postTags, asc, isNull } from '@/lib/server/db'
import { escapeCSV } from '@/lib/server/utils/csv'
import type { EntityExporter } from '../types'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '')

async function fetchBoards(offset: number, limit: number) {
  return db.query.boards.findMany({
    where: isNull(boards.deletedAt),
    orderBy: asc(boards.createdAt),
    offset,
    limit,
    columns: { id: true, slug: true, name: true, description: true, createdAt: true },
  })
}
type BoardRow = Awaited<ReturnType<typeof fetchBoards>>[number]

export const boardsExporter: EntityExporter<BoardRow> = {
  key: 'boards',
  fileName: 'boards.csv',
  pageSize: 5000,
  header: 'id,slug,name,description,created_at',
  fetchPage: fetchBoards,
  serialize: (b) =>
    [
      b.id,
      escapeCSV(b.slug),
      escapeCSV(b.name),
      escapeCSV(b.description ?? ''),
      iso(b.createdAt),
    ].join(','),
}

async function fetchStatuses(offset: number, limit: number) {
  return db.query.postStatuses.findMany({
    where: isNull(postStatuses.deletedAt),
    orderBy: asc(postStatuses.createdAt),
    offset,
    limit,
    columns: {
      id: true,
      name: true,
      slug: true,
      color: true,
      category: true,
      position: true,
      showOnRoadmap: true,
      isDefault: true,
    },
  })
}
type StatusRow = Awaited<ReturnType<typeof fetchStatuses>>[number]

export const statusesExporter: EntityExporter<StatusRow> = {
  key: 'statuses',
  fileName: 'statuses.csv',
  pageSize: 5000,
  header: 'id,name,slug,color,category,position,show_on_roadmap,is_default',
  fetchPage: fetchStatuses,
  serialize: (s) =>
    [
      s.id,
      escapeCSV(s.name),
      escapeCSV(s.slug),
      s.color,
      s.category,
      String(s.position),
      String(s.showOnRoadmap),
      String(s.isDefault),
    ].join(','),
}

async function fetchTags(offset: number, limit: number) {
  return db.query.postTags.findMany({
    where: isNull(postTags.deletedAt),
    orderBy: asc(postTags.createdAt),
    offset,
    limit,
    columns: { id: true, name: true, color: true, description: true },
  })
}
type TagRow = Awaited<ReturnType<typeof fetchTags>>[number]

export const tagsExporter: EntityExporter<TagRow> = {
  key: 'tags',
  fileName: 'tags.csv',
  pageSize: 5000,
  header: 'id,name,color,description',
  fetchPage: fetchTags,
  serialize: (t) => [t.id, escapeCSV(t.name), t.color, escapeCSV(t.description ?? '')].join(','),
}

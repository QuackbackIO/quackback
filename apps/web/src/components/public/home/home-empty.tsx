/**
 * Home's blocks that draw nothing with the data the workspace has: Welcome
 * without words, and a block of the workspace's data with nothing to show
 * that hides then (a roadmap with no roadmap or columns, Latest updates with
 * no entries, Help topics with no topics, Status with no components, Top
 * posts with no posts when it is told to hide). Home lays its grid out
 * without them, so the rest close up as they always did, rather than leaving
 * a hole where a block draws nothing. The data is read once it is in; the
 * blocks read the same queries, so nothing is fetched twice.
 */
import type { ReactNode } from 'react'
import {
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { portalQueries } from '@/lib/client/queries/portal'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { publicStatusPageQueries } from '@/lib/client/queries/status'
import {
  chosenTopics,
  roadmapColumns,
  whenEmptyOf,
  type DataBlock,
} from '@/lib/shared/design/block-content'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { TiptapContent } from '@/lib/shared/db-types'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'

type Block = PortalDesign['pages']['home']['blocks'][number]

/** What tells whether a block has anything to draw; absent is not asked. */
export interface HomeData {
  roadmaps?: ReadonlyArray<{ id: string; columns: ReadonlyArray<{ statusId?: string | null }> }>
  entries?: number
  categories?: ReadonlyArray<{ id: string; parentId?: string | null }>
  /** How many components the status page shows. */
  statusComponents?: number
  /** How many posts each Top posts block that hides when empty found, by its index. */
  ideas?: ReadonlyMap<number, number>
}

/** Whether a block of the workspace's data has nothing to show; undefined until its data is in. */
export function nothingToShow(
  block: DataBlock,
  index: number,
  data: HomeData
): boolean | undefined {
  switch (block.type) {
    case 'ideas': {
      const found = data.ideas?.get(index)
      return found === undefined ? undefined : found === 0
    }
    case 'roadmap': {
      if (!data.roadmaps) return undefined
      const roadmap =
        data.roadmaps.find((candidate) => candidate.id === block.roadmapId) ?? data.roadmaps[0]
      return roadmapColumns(roadmap, block).length === 0
    }
    case 'updates':
      return data.entries === undefined ? undefined : data.entries === 0
    case 'help_topics':
      return data.categories
        ? chosenTopics(data.categories, block.categoryIds).length === 0
        : undefined
    case 'status':
      return data.statusComponents === undefined ? undefined : data.statusComponents === 0
  }
}

const DATA_TYPES: ReadonlySet<Block['type']> = new Set([
  'ideas',
  'roadmap',
  'updates',
  'help_topics',
  'status',
])
export const isDataBlock = (block: Block): block is DataBlock => DATA_TYPES.has(block.type)

/**
 * The indexes of the blocks that draw nothing, from the data given. With
 * `samples` (the builder) a block of the workspace's data is never left out:
 * it draws samples, or its message, so it can be seen and styled; nor is an
 * empty Welcome, which draws a place to write it.
 */
export function emptyBlocks(
  blocks: readonly Block[],
  data: HomeData,
  { samples = false }: { samples?: boolean } = {}
): Set<number> {
  const empty = new Set<number>()
  blocks.forEach((block, index) => {
    // The builder draws an empty Welcome as a place to write it.
    if (!samples && block.type === 'welcome' && isEmptyTiptapDoc(block.body as TiptapContent))
      empty.add(index)
    if (
      !samples &&
      isDataBlock(block) &&
      whenEmptyOf(block) === 'hide' &&
      nothingToShow(block, index, data)
    )
      empty.add(index)
  })
  return empty
}

function Roadmaps({ children }: { children: (data: HomeData['roadmaps']) => ReactNode }) {
  return children(useSuspenseQuery(portalQueries.roadmaps()).data)
}

function Entries({ children }: { children: (count: number) => ReactNode }) {
  const { data } = useSuspenseInfiniteQuery(publicChangelogQueries.list())
  return children(data.pages.reduce((sum, page) => sum + page.items.length, 0))
}

function Categories({ children }: { children: (data: HomeData['categories']) => ReactNode }) {
  return children(useSuspenseQuery(publicHelpCenterQueries.categories()).data)
}

function StatusComponents({ children }: { children: (count: number) => ReactNode }) {
  const { snapshot } = useSuspenseQuery(publicStatusPageQueries.get()).data
  const count =
    snapshot.ungroupedComponents.length +
    snapshot.groups.reduce((sum, group) => sum + group.components.length, 0)
  return children(count)
}

/** The posts found by each Top posts block that hides when it has none, by index. */
function IdeasFound({
  blocks,
  children,
}: {
  blocks: ReadonlyArray<readonly [index: number, block: Extract<Block, { type: 'ideas' }>]>
  children: (found: ReadonlyMap<number, number>) => ReactNode
}) {
  const results = useSuspenseQueries({
    queries: blocks.map(([, block]) => portalQueries.homeIdeas(block)),
  })
  return children(
    new Map(blocks.map(([index], at) => [index, results[at]!.data.items.length] as const))
  )
}

/**
 * Reads what Home's blocks need to know whether they draw anything, waiting
 * for it, and hands it on. Only the data Home's blocks ask about is read.
 */
export function WithHomeData({
  blocks,
  gates,
  children,
}: {
  blocks: readonly Block[]
  gates: PortalPageGates
  children: (data: HomeData) => ReactNode
}) {
  const has = (type: Block['type']) => blocks.some((block) => block.type === type)
  // Top posts asks only for the blocks that hide when they have none, as no other draws differently.
  const hidingIdeas = gates.feedback
    ? blocks.flatMap((block, index) =>
        block.type === 'ideas' && whenEmptyOf(block) === 'hide' ? [[index, block] as const] : []
      )
    : []
  const needs = {
    roadmaps: gates.roadmap && has('roadmap'),
    entries: gates.changelog && has('updates'),
    categories: gates.help && has('help_topics'),
    status: gates.status && has('status'),
  }
  const withIdeas = (data: HomeData) =>
    hidingIdeas.length ? (
      <IdeasFound blocks={hidingIdeas}>{(ideas) => children({ ...data, ideas })}</IdeasFound>
    ) : (
      children(data)
    )
  const withStatus = (data: HomeData) =>
    needs.status ? (
      <StatusComponents>
        {(statusComponents) => withIdeas({ ...data, statusComponents })}
      </StatusComponents>
    ) : (
      withIdeas(data)
    )
  const withCategories = (data: HomeData) =>
    needs.categories ? (
      <Categories>{(categories) => withStatus({ ...data, categories })}</Categories>
    ) : (
      withStatus(data)
    )
  const withEntries = (data: HomeData) =>
    needs.entries ? (
      <Entries>{(entries) => withCategories({ ...data, entries })}</Entries>
    ) : (
      withCategories(data)
    )
  return needs.roadmaps ? (
    <Roadmaps>{(roadmaps) => withEntries({ roadmaps })}</Roadmaps>
  ) : (
    withEntries({})
  )
}

/**
 * What Home's blocks of the workspace's data show of it: the roadmap columns
 * and help topics they draw, what each item shows, whether a status page has
 * anything to say, and what a block does with nothing to show. The data is
 * the customer's: these only choose from it, never write it.
 */
import type { HomeBlock } from './home'

/** A block that shows the workspace's data and has an empty state of its own. */
export type DataBlock = Extract<
  HomeBlock,
  { type: 'ideas' | 'roadmap' | 'updates' | 'help_topics' | 'status' }
>

/** What a block does with nothing to show: as it always did when it does not say. */
export function whenEmptyOf(block: DataBlock): 'hide' | 'message' {
  return block.whenEmpty ?? (block.type === 'ideas' ? 'message' : 'hide')
}

/** Each item part's usual setting, for a block that leaves it out. */
const SHOWN_USUALLY = {
  showVotes: { ideas: true, roadmap: false },
  showStatus: { ideas: true },
  showComments: { ideas: false },
  showDate: { updates: true },
  showSummary: { updates: false },
  showCounts: { help_topics: true, boards: true },
  showIncidents: { status: true },
} as const

type ShowKey = keyof typeof SHOWN_USUALLY

/** Whether a block shows one part of each item, its usual when it does not say. */
export function shows<B extends HomeBlock>(block: B, key: ShowKey & keyof B): boolean {
  const own = block[key]
  if (typeof own === 'boolean') return own
  return (SHOWN_USUALLY[key] as Partial<Record<HomeBlock['type'], boolean>>)[block.type] ?? false
}

/** The columns a roadmap block draws: those with a status, the picked ones only when it picks. */
export function roadmapColumns<C extends { statusId?: string | null }>(
  roadmap: { columns: readonly C[] } | undefined,
  block: Extract<HomeBlock, { type: 'roadmap' }>
): C[] {
  const withStatus = (roadmap?.columns ?? []).filter((column) => column.statusId)
  const picked: readonly string[] = block.statusIds ?? []
  return picked.length
    ? withStatus.filter((column) => picked.includes(column.statusId as string))
    : withStatus
}

/** Help topics a block shows at most. */
export const TOPICS_MAX = 8

/**
 * The help topics a block draws: the picked top-level topics in the order
 * picked, or the first top-level ones. A sub-topic is never drawn on its own.
 */
export function chosenTopics<C extends { id: string; parentId?: string | null }>(
  categories: readonly C[],
  picked: readonly string[]
): C[] {
  const topLevel = categories.filter((category) => !category.parentId)
  if (!picked.length) return topLevel.slice(0, TOPICS_MAX)
  return picked
    .map((id) => topLevel.find((category) => category.id === id))
    .filter((category): category is C => !!category)
    .slice(0, TOPICS_MAX)
}

/** Whether a status page shows any component, so its overall status says something true. */
export function statusHasComponents(snapshot: {
  groups: ReadonlyArray<{ components: readonly unknown[] }>
  ungroupedComponents: readonly unknown[]
}): boolean {
  return (
    snapshot.ungroupedComponents.length > 0 ||
    snapshot.groups.some((group) => group.components.length > 0)
  )
}

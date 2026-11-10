/**
 * Sample content for the feedback boards, the roadmap and the changelog: one
 * made-up product's posts, shown on the board, grouped on the roadmap and
 * shipped in the changelog. Part of the designer's sample content (see
 * sample-content.ts); nothing here touches the database.
 */
import type { fetchPortalData, fetchPublicRoadmaps } from '@/lib/server/functions/portal'
import type { fetchPublicRoadmapPosts } from '@/lib/server/functions/portal'
import type { listPublicChangelogsFn } from '@/lib/server/functions/changelog'
import type { listChangelogCategoriesFn } from '@/lib/server/functions/changelog-categories'

export type SamplePortalData = Awaited<ReturnType<typeof fetchPortalData>>
export type SampleRoadmap = Awaited<ReturnType<typeof fetchPublicRoadmaps>>[number]
export type SampleRoadmapColumn = Awaited<ReturnType<typeof fetchPublicRoadmapPosts>>
export type SampleChangelogEntry = Awaited<
  ReturnType<typeof listPublicChangelogsFn>
>['items'][number]
export type SampleChangelogCategory = Awaited<ReturnType<typeof listChangelogCategoriesFn>>[number]

type Board = SamplePortalData['boards'][number]
type Status = SamplePortalData['statuses'][number]
type Tag = SamplePortalData['tags'][number]
type Post = SamplePortalData['posts']['items'][number]

const DAY = 86_400_000
const id = <T>(name: string) => `sample_${name}` as T

const STATUSES: Array<[string, string, Status['category'], boolean]> = [
  ['Open', '#64748b', 'active', false],
  ['Planned', '#7c3aed', 'active', true],
  ['In progress', '#2563eb', 'active', true],
  ['Shipped', '#16a34a', 'complete', true],
]

const BOARDS: Array<[string, string]> = [
  ['Feature requests', 'Posts about what to build next.'],
  ['Bugs', 'Something not working as it should.'],
]

const TAGS: Array<[string, string]> = [
  ['Mobile', '#0891b2'],
  ['Reports', '#ca8a04'],
]

/** Title, board, status, votes, comments, days ago, tag, author. */
const POSTS: Array<[string, number, number, number, number, number, number | null, string]> = [
  ['Dark mode for the whole app', 0, 2, 128, 14, 3, null, 'Sam Lee'],
  ['Export reports to a spreadsheet', 0, 1, 96, 9, 8, 1, 'Alex Kim'],
  ['Reminders before a task is due', 0, 3, 81, 6, 20, null, 'Jordan Patel'],
  ['A home screen widget on phones', 0, 1, 64, 5, 12, 0, 'Riley Chen'],
  ['Saved filters on the task list', 0, 0, 42, 3, 2, null, 'Taylor Brooks'],
  ['Calendar sync drops recurring events', 1, 2, 37, 8, 4, null, 'Morgan Diaz'],
  ['Charts on the weekly report', 0, 0, 25, 2, 1, 1, 'Casey Morgan'],
  ['Keyboard shortcuts for common actions', 0, 3, 19, 1, 30, null, 'Jamie Fox'],
]

function slugOf(name: string): string {
  return name.toLowerCase().replace(/\W+/g, '-')
}

function statuses(now: Date): Status[] {
  return STATUSES.map(([name, color, category, showOnRoadmap], position) => ({
    id: id(`status_${position}`),
    name,
    slug: slugOf(name),
    color,
    category,
    position,
    showOnRoadmap,
    isDefault: position === 0,
    createdAt: now,
    deletedAt: null,
  })) satisfies Status[]
}

function boards(now: Date): Board[] {
  return BOARDS.map(([name, description], index) => ({
    id: id(`board_${index}`),
    slug: slugOf(name),
    name,
    description,
    isPublic: true,
    settings: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    postCount: POSTS.filter((post) => post[1] === index).length,
  })) satisfies Board[]
}

function tags(now: Date): Tag[] {
  return TAGS.map(([name, color], index) => ({
    id: id(`tag_${index}`),
    name,
    color,
    description: null,
    aiPrompt: null,
    isPublic: true,
    createdAt: now,
    deletedAt: null,
  })) satisfies Tag[]
}

function posts(now: Date): Post[] {
  const boardList = boards(now)
  const tagList = tags(now)
  return POSTS.map(
    ([title, board, status, voteCount, commentCount, daysAgo, tag, author], index) => ({
      id: id(`post_${index}`),
      title,
      content: `${title}. It would save our team time every week.`,
      statusId: id(`status_${status}`),
      voteCount,
      authorName: author,
      principalId: id(`principal_${index}`),
      createdAt: new Date(now.getTime() - daysAgo * DAY).toISOString(),
      commentCount,
      tags:
        tag === null
          ? []
          : [{ id: tagList[tag]!.id, name: tagList[tag]!.name, color: tagList[tag]!.color }],
      board: {
        id: boardList[board]!.id,
        name: boardList[board]!.name,
        slug: boardList[board]!.slug,
      },
      changelogEntry: null,
    })
  ) satisfies Post[]
}

/** The feedback board: its boards, posts, statuses and tags, as the feed loads them. */
export function sampleFeedback(now: Date): SamplePortalData {
  const boardList = boards(now)
  return {
    boards: boardList,
    posts: { items: posts(now), hasMore: false, total: undefined },
    statuses: statuses(now),
    tags: tags(now),
    votedPostIds: [],
    principalId: null,
    boardPermissions: Object.fromEntries(
      boardList.map((board) => [board.id, { canSubmit: true, canVote: true }])
    ),
    facets: null,
  } satisfies SamplePortalData
}

/** The roadmap: one roadmap with a column for each status it shows, and their posts. */
export function sampleRoadmap(now: Date): {
  roadmaps: SampleRoadmap[]
  columns: Record<string, SampleRoadmapColumn>
  boards: Board[]
  statuses: Status[]
  tags: Tag[]
} {
  const statusList = statuses(now)
  const shown = statusList.filter((status) => status.showOnRoadmap)
  const roadmapId = id<SampleRoadmap['id']>('roadmap_product')
  const roadmap = {
    id: roadmapId,
    name: 'Product roadmap',
    slug: 'product-roadmap',
    description: null,
    type: 'column',
    baseFilter: {},
    dateSource: null,
    frequency: null,
    visibility: 'public',
    visibleSegmentIds: null,
    position: 0,
    columns: shown.map((status, position) => ({
      id: id(`column_${position}`),
      roadmapId,
      statusId: status.id,
      name: status.name,
      icon: null,
      color: status.color,
      position,
    })),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  } satisfies SampleRoadmap
  const all = posts(now)
  const columns = Object.fromEntries(
    shown.map((status) => {
      const items = all
        .filter((post) => post.statusId === status.id)
        .map((post) => ({
          id: String(post.id),
          title: post.title,
          voteCount: post.voteCount,
          commentCount: post.commentCount,
          statusId: String(status.id),
          eta: null,
          board: { id: String(post.board!.id), name: post.board!.name, slug: post.board!.slug },
        }))
      return [status.id, { items, hasMore: false, total: items.length }]
    })
  ) as Record<string, SampleRoadmapColumn>
  return {
    roadmaps: [roadmap],
    columns,
    boards: boards(now),
    statuses: statusList,
    tags: tags(now),
  }
}

const ENTRIES: Array<[string, string, number, number]> = [
  [
    'Dark mode is here',
    'Switch the whole app to dark mode from your profile. It follows your device by default.',
    2,
    0,
  ],
  [
    'Keyboard shortcuts',
    'Press ? anywhere to see every shortcut. Create, assign and close tasks without the mouse.',
    16,
    0,
  ],
  [
    'Faster search',
    'Search now finds records as you type, across every project you can open.',
    34,
    1,
  ],
]

const CATEGORIES: Array<[string, string]> = [
  ['New', '#16a34a'],
  ['Improved', '#2563eb'],
]

/** The changelog: a few recent entries and the labels they carry. */
export function sampleChangelog(now: Date): {
  entries: SampleChangelogEntry[]
  categories: SampleChangelogCategory[]
} {
  const categories = CATEGORIES.map(([name, color], position) => ({
    id: id(`label_${position}`),
    name,
    color,
    segmentIds: [],
    position,
    createdAt: now,
  })) satisfies SampleChangelogCategory[]
  const entries = ENTRIES.map(([title, content, daysAgo, category], index) => ({
    id: id(`entry_${index}`),
    title,
    content,
    contentJson: null,
    publishedAt: new Date(now.getTime() - daysAgo * DAY).toISOString(),
    linkedPosts: [],
    categories: [categories[category]!],
    featuredImageUrl: null,
  })) satisfies SampleChangelogEntry[]
  return { entries, categories }
}

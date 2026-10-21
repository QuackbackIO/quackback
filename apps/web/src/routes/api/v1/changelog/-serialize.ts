import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import type {
  ChangelogLinkedPost,
  ChangelogCategorySummary,
} from '@/lib/server/domains/changelog/changelog.types'

/**
 * Public, stable changelog entry shape for the REST API.
 *
 * Categories are exposed as `labels` — "Labels" is what the admin UI calls
 * them, and "category" already means something else on this API (post
 * statuses have a `category`). The internal entity keeps its name.
 */
export function formatChangelogResponse(entry: {
  id: string
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: Date | null
  displayDate: Date | null
  createdAt: Date
  updatedAt: Date
  linkedPosts?: ChangelogLinkedPost[]
  categories?: ChangelogCategorySummary[]
}) {
  return {
    id: entry.id,
    title: entry.title,
    content: contentJsonToMarkdown(entry.contentJson, entry.content),
    publishedAt: entry.publishedAt?.toISOString() || null,
    displayDate: entry.displayDate?.toISOString() || null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    linkedPosts: (entry.linkedPosts ?? []).map((post) => ({
      id: post.id,
      title: post.title,
      voteCount: post.voteCount,
      status: post.status,
    })),
    labels: (entry.categories ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
    })),
  }
}

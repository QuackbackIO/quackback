import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import type { ChangelogLinkedPost } from '@/lib/server/domains/changelog/changelog.types'

/** Public, stable changelog entry shape for the REST API. */
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
  }
}

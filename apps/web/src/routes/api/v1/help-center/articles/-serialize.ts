import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'

/**
 * Public, stable help-center article shape for the read API. `content` is
 * rendered from the canonical `contentJson` so images survive as markdown
 * (see {@link contentJsonToMarkdown}); list queries pass `contentJson: null`
 * and fall back to the stored column.
 */
export function formatArticle(article: {
  id: string
  slug: string
  title: string
  description: string | null
  content: string
  contentJson: TiptapContent | null
  publishedAt: Date | null
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  createdAt: Date
  updatedAt: Date
  category: { id: string; slug: string; name: string }
  author: { id: string; name: string; avatarUrl: string | null } | null
}) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    description: article.description,
    content: contentJsonToMarkdown(article.contentJson, article.content),
    publishedAt: article.publishedAt?.toISOString() || null,
    viewCount: article.viewCount,
    helpfulCount: article.helpfulCount,
    notHelpfulCount: article.notHelpfulCount,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    category: article.category,
    author: article.author,
  }
}

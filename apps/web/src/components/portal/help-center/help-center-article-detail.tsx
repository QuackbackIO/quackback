import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { BackLink } from '@/components/ui/back-link'
import type { JSONContent } from '@tiptap/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import { HelpCenterArticleFeedback } from './help-center-article-feedback'

interface HelpCenterArticleDetailProps {
  id: string
  title: string
  content: string
  contentJson: TiptapContent | null
  categorySlug: string
  categoryName: string
  author: { id: string; name: string; avatarUrl: string | null } | null
  helpfulCount: number
  notHelpfulCount: number
}

export function HelpCenterArticleDetail({
  id,
  title,
  content,
  contentJson,
  categorySlug,
  categoryName,
  author,
  helpfulCount,
  notHelpfulCount,
}: HelpCenterArticleDetailProps) {
  return (
    <article>
      <BackLink to="/help/$categorySlug" params={{ categorySlug }} className="mb-8">
        {categoryName}
      </BackLink>

      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold leading-tight">{title}</h1>

        {author && <p className="text-sm text-muted-foreground mt-3">By {author.name}</p>}

        <div className="mt-6">
          {contentJson && isRichTextContent(contentJson) ? (
            <RichTextContent content={contentJson as JSONContent} />
          ) : (
            <p className="whitespace-pre-wrap">{content}</p>
          )}
        </div>

        <HelpCenterArticleFeedback
          articleId={id}
          helpfulCount={helpfulCount}
          notHelpfulCount={notHelpfulCount}
        />
      </div>
    </article>
  )
}

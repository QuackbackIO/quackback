import { createFileRoute, redirect } from '@tanstack/react-router'
import { canonicalArticleTypeId } from '@/lib/shared/widget/article-ref'

/** Bookmarks of the old full-page editor land on the list with the article modal open. */
export const Route = createFileRoute('/admin/help-center/articles/$articleId')({
  beforeLoad: ({ params }) => {
    const canonical = canonicalArticleTypeId(params.articleId)
    throw redirect({
      to: '/admin/help-center',
      search: canonical ? { article: canonical } : {},
      replace: true,
    })
  },
  component: () => null,
})

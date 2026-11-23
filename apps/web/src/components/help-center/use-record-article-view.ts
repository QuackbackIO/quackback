import { useEffect } from 'react'
import { recordPublicArticleViewFn } from '@/lib/server/functions/help-center'

/**
 * Count one view of the article a page shows, once per article. Runs from the
 * page rather than its loader, which also runs on hover preloads.
 */
export function useRecordArticleView(articleId: string): void {
  useEffect(() => {
    recordPublicArticleViewFn({ data: { articleId } }).catch(() => {
      // A missed view count never gets in the reader's way.
    })
  }, [articleId])
}

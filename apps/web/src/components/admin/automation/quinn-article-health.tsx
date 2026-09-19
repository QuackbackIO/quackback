/**
 * Whether Quinn can read the help centre (QUINN-PRODUCT Step 11, P8).
 *
 * Documents and web pages get a note per row, because the Knowledge page lists
 * them. Articles live on their own screens and there can be hundreds, so this
 * is the same honesty at the level the page can carry: nothing at all when
 * every article is indexed, and otherwise the count and the first few names.
 *
 * The vocabulary is `indexNote`'s, deliberately reused rather than restated, so
 * an article and a document in the same state read the same way.
 */
import { useQuery } from '@tanstack/react-query'
import { getArticleIndexHealthFn } from '@/lib/server/functions/assistant-source-use'
import { indexNote } from './quinn-knowledge-sources'

export function QuinnArticleHealth() {
  const health = useQuery({
    queryKey: ['assistant', 'knowledgeSources', 'health', 'article'],
    queryFn: () => getArticleIndexHealthFn(),
    staleTime: 60_000,
  })

  if (!health.data) return null
  const { total, unhealthy } = health.data
  if (total === 0 || unhealthy.length === 0) return null

  return (
    <div className="mt-2 space-y-0.5">
      <p className="text-muted-foreground text-xs">
        {unhealthy.length} of {total} articles need attention
      </p>
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        {unhealthy.map((article) => (
          <li key={article.id} className="truncate">
            {article.title}
            {' — '}
            {indexNote({
              status: article.status,
              serving: article.serving,
              degraded: article.degraded,
            }) ?? 'Not indexed'}
          </li>
        ))}
      </ul>
    </div>
  )
}

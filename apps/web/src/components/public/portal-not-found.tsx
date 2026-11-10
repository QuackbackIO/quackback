import { useRouterState } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorPageCopy, FriendlyShell } from '@/components/shared/error-page'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'
import { useFeedbackPath } from './use-portal-paths'

/** A post's address. */
const POST_PATH = /^\/b\/[^/]+\/posts\//

/**
 * The board a missing post belongs to, as its page's loader found it: only
 * a board that exists, so the way on never leads to another missing page.
 */
function knownBoard(state: {
  matches: ReadonlyArray<{ status?: string; error?: unknown }>
}): string | null {
  for (const match of state.matches) {
    if (match.status !== 'notFound') continue
    const board = (match.error as { data?: { board?: unknown } } | undefined)?.data?.board
    if (typeof board === 'string' && board) return board
  }
  return null
}

/**
 * The portal's page for an address with nothing at it, inside the portal's
 * header and footer: the brand's icon or no image, and the ways on. A post
 * that is gone leads to its board and to a search of the posts.
 */
export function PortalNotFound() {
  const post = useRouterState({ select: (state) => POST_PATH.test(state.location.pathname) })
  const board = useRouterState({ select: knownBoard })
  const feed = useFeedbackPath()
  return (
    <FriendlyShell>
      <ErrorPageCopy>
        {(copy) => (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              {copy({ id: 'common.errorPage.notFound.title', defaultMessage: 'Page not found' })}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {copy({
                id: 'common.errorPage.notFound.description',
                defaultMessage:
                  "The page you're looking for doesn't exist. It may have been moved or deleted, or the link may be incorrect.",
              })}
            </p>
            {post && (
              <form role="search" action={feed} method="get" className="mt-6 flex gap-2">
                <Input
                  name="search"
                  type="search"
                  aria-label={copy({
                    id: 'common.errorPage.notFound.search',
                    defaultMessage: 'Search posts',
                  })}
                  placeholder={copy({
                    id: 'common.errorPage.notFound.search',
                    defaultMessage: 'Search posts',
                  })}
                />
              </form>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {board && (
                <Button asChild>
                  <a href={`${feed}?board=${encodeURIComponent(board)}`}>
                    {copy({
                      id: 'common.errorPage.notFound.board',
                      defaultMessage: 'Go to the board',
                    })}
                  </a>
                </Button>
              )}
              <Button variant="outline" asChild>
                <a href={PORTAL_LANDING}>
                  {copy({ id: 'common.errorPage.goHome', defaultMessage: 'Go home' })}
                </a>
              </Button>
            </div>
          </>
        )}
      </ErrorPageCopy>
    </FriendlyShell>
  )
}

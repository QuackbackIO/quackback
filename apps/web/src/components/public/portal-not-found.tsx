import { useRouterState } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorPageCopy, FriendlyShell } from '@/components/shared/error-page'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'
import { useFeedbackPath } from './use-portal-paths'

/** A post's address: its board's slug is the second segment. */
const POST_PATH = /^\/b\/([^/]+)\/posts\//

/** The board a post's address names, read once, or null. */
function boardOf(pathname: string): string | null {
  const slug = POST_PATH.exec(pathname)?.[1]
  if (!slug) return null
  try {
    return decodeURIComponent(slug)
  } catch {
    return null
  }
}

/**
 * The portal's page for an address with nothing at it, inside the portal's
 * header and footer: the brand's icon or no image, and the ways on. A post
 * that is gone leads to its board and to a search of the posts.
 */
export function PortalNotFound() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const feed = useFeedbackPath()
  const board = boardOf(pathname)
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
            {board && (
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

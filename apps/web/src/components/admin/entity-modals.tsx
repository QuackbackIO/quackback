/**
 * The post, changelog entry and article modals an admin page opens from the
 * URL. Their dialog frames render with the admin layout, so a dialog opens at
 * once; each modal's content (editors, sidebars and their reads) loads inside
 * its frame, behind the frame's spinner. Opening one mounts one dialog.
 */
import { lazy, useCallback, useLayoutEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import type { ArticleId, ChangelogId, PostId } from '@quackback/ids'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import type { CurrentUser } from '@/lib/shared/types'

const PostModalContent = lazy(() =>
  import('@/components/admin/feedback/post-modal').then((m) => ({ default: m.PostModalContent }))
)
const ChangelogModalContent = lazy(() =>
  import('@/components/admin/changelog/changelog-modal').then((m) => ({
    default: m.ChangelogModalContent,
  }))
)
const ArticleModalContent = lazy(() =>
  import('@/components/admin/help-center/article-modal').then((m) => ({
    default: m.ArticleModalContent,
  }))
)

export function PostModal({
  postId: urlPostId,
  currentUser,
}: {
  postId: string | undefined
  currentUser: CurrentUser
}) {
  const { pathname, search } = useRouterState({ select: (s) => s.location })
  const { open, validatedId, close, navigateTo } = useUrlModal<PostId>({
    urlId: urlPostId,
    idPrefix: 'post',
    searchParam: 'post',
    route: pathname,
    search: search as Record<string, unknown>,
  })

  // useUrlModal's callbacks change with every location; the content gets
  // stable ones that call the latest.
  const latest = useRef({ close, navigateTo })
  useLayoutEffect(() => {
    latest.current = { close, navigateTo }
  })
  const onClose = useCallback(() => latest.current.close(), [])
  const onNavigateToPost = useCallback((id: string) => latest.current.navigateTo(id), [])

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit post"
      hasValidId={!!validatedId}
    >
      {validatedId && (
        <PostModalContent
          postId={validatedId}
          currentUser={currentUser}
          onNavigateToPost={onNavigateToPost}
          onClose={onClose}
        />
      )}
    </UrlModalShell>
  )
}

export function ChangelogModal({ entryId: urlEntryId }: { entryId: string | undefined }) {
  const { pathname, search } = useRouterState({ select: (s) => s.location })
  const { open, validatedId, close } = useUrlModal<ChangelogId>({
    urlId: urlEntryId,
    idPrefix: 'changelog',
    searchParam: 'entry',
    route: pathname,
    search: search as Record<string, unknown>,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit changelog entry"
      hasValidId={!!validatedId}
    >
      {validatedId && <ChangelogModalContent entryId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}

export function ArticleModal({ articleId: urlArticleId }: { articleId: string | undefined }) {
  const { pathname, search } = useRouterState({ select: (s) => s.location })
  const { open, validatedId, close } = useUrlModal<ArticleId>({
    urlId: urlArticleId,
    idPrefix: 'article',
    searchParam: 'article',
    route: pathname,
    search: search as Record<string, unknown>,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit article"
      hasValidId={!!validatedId}
    >
      {validatedId && <ArticleModalContent articleId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}

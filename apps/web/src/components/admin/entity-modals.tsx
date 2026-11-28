/**
 * The post, changelog entry and article modals an admin page opens from the
 * URL. Their dialog frames render with the admin layout, so a dialog opens at
 * once; each modal's content (editors, sidebars and their reads) loads inside
 * its frame, behind the frame's spinner. Opening one mounts one dialog.
 */
import { lazy } from 'react'
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
  const { open, validatedId, close, navigateTo } = useUrlModal<PostId>({
    urlId: urlPostId,
    idPrefix: 'post',
    searchParam: 'post',
  })

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
          onNavigateToPost={navigateTo}
          onClose={close}
        />
      )}
    </UrlModalShell>
  )
}

export function ChangelogModal({ entryId: urlEntryId }: { entryId: string | undefined }) {
  const { open, validatedId, close } = useUrlModal<ChangelogId>({
    urlId: urlEntryId,
    idPrefix: 'changelog',
    searchParam: 'entry',
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
  const { open, validatedId, close } = useUrlModal<ArticleId>({
    urlId: urlArticleId,
    idPrefix: 'article',
    searchParam: 'article',
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

// @vitest-environment happy-dom
/**
 * A post can be created with a title alone. Without details there is no
 * document, so the payload must leave `contentJson` out: the server accepts it
 * missing and refuses it null.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { createId } from '@quackback/ids'
import { createPostSchema } from '@/lib/shared/schemas/posts'

const mutate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/client/mutations/posts', () => ({
  useCreatePost: () => ({ mutate, isPending: false, error: null }),
}))
vi.mock('@/lib/client/mutations', () => ({
  useCreatePortalUser: () => ({ mutateAsync: vi.fn() }),
  useUpdatePortalUser: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [] }),
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePostMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/components/ui/lazy-rich-text-editor', () => ({ LazyRichTextEditor: () => null }))
vi.mock('@/components/shared/author-selector', () => ({ AuthorSelector: () => null }))

import { CreatePostDialog } from '../create-post-dialog'

afterEach(() => {
  cleanup()
  mutate.mockReset()
})

describe('CreatePostDialog', () => {
  it('creates a post from a title alone, as a payload the server accepts', async () => {
    const boardId = createId('board')
    const statusId = createId('post_status')
    render(
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CreatePostDialog
          open
          onOpenChange={() => {}}
          boards={[{ id: boardId, name: 'Ideas', slug: 'ideas' } as never]}
          tags={[]}
          statuses={[{ id: statusId, name: 'Open', isDefault: true } as never]}
          currentUser={
            { principalId: 'principal_1', name: 'Sam', email: 'sam@example.com' } as never
          }
        />
      </IntlProvider>
    )

    fireEvent.change(screen.getByLabelText("What's the feedback about?"), {
      target: { value: 'Dark mode' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create post/i }))

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    const payload = mutate.mock.calls[0]![0] as Record<string, unknown>
    expect('contentJson' in payload).toBe(false)
    const { authorPrincipalId: _author, ...input } = payload
    expect(createPostSchema.safeParse(input).success).toBe(true)
  })
})

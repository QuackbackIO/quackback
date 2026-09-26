// @vitest-environment happy-dom
/**
 * The similar-posts card sits beside a title being typed, and the search
 * behind it renders on every keystroke. The card renders again only when what
 * it shows changes: its posts or whether it is shown. The search hands it the
 * same empty list until it finds something.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const { presence } = vi.hoisted(() => ({ presence: { renders: 0 } }))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => {
    presence.renders++
    return children
  },
  motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
}))
vi.mock('@/components/public/vote-button', () => ({ VoteButton: () => null }))
vi.mock('@/lib/server/functions/public-posts', () => ({ findSimilarPostsFn: vi.fn() }))

import { SimilarPostsCard } from '../similar-posts-card'
import { useSimilarPosts, type SimilarPost } from '@/lib/client/hooks/use-similar-posts'

afterEach(() => {
  cleanup()
  presence.renders = 0
})

const POST = {
  id: 'post_1',
  title: 'Dark mode',
  boardSlug: 'ideas',
  voteCount: 3,
  status: null,
} as unknown as SimilarPost

const ignoreIntlErrors = () => {}

function Host({ posts, show }: { keystroke: number; posts: SimilarPost[]; show: boolean }) {
  return (
    <IntlProvider locale="en" onError={ignoreIntlErrors}>
      <SimilarPostsCard posts={posts} show={show} className="px-4" />
    </IntlProvider>
  )
}

describe('similar posts card', () => {
  it('renders again only when its posts or visibility change', () => {
    const none: SimilarPost[] = []
    const { rerender } = render(<Host keystroke={1} posts={none} show={false} />)
    presence.renders = 0

    rerender(<Host keystroke={2} posts={none} show={false} />)
    rerender(<Host keystroke={3} posts={none} show={false} />)
    expect(presence.renders).toBe(0)

    rerender(<Host keystroke={4} posts={none} show={true} />)
    expect(presence.renders).toBe(1)

    const found = [POST]
    rerender(<Host keystroke={5} posts={found} show={true} />)
    expect(presence.renders).toBe(2)
    rerender(<Host keystroke={6} posts={found} show={true} />)
    expect(presence.renders).toBe(2)
  })

  it('is handed the same empty list until the search finds something', () => {
    const client = new QueryClient()
    const { result, rerender } = renderHook(
      ({ title }: { title: string }) => useSimilarPosts({ title }),
      {
        initialProps: { title: 'Da' },
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    )
    const first = result.current.posts
    rerender({ title: 'Dar' })
    rerender({ title: 'Dark' })
    expect(result.current.posts).toEqual([])
    expect(result.current.posts).toBe(first)
  })
})

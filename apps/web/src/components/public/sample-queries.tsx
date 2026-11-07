import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import type { SampleContent } from '@/lib/server/domains/design/sample-content'

/** What a query is answered with, or undefined when the sample has nothing for it. */
type Answers = (key: QueryKey) => unknown

const NOTHING_SENT = "The designer's sample sends nothing"

/**
 * A query client that answers every query from a sample and never asks the
 * server: each query's own fetch is replaced by the sample's answer, given
 * up front so the page draws at once, and nothing goes stale. A query the
 * sample has no answer for fails, and no change is ever sent.
 */
export function sampleQueryClient(answers: Answers): QueryClient {
  const client = new QueryClient()
  const queryDefaults = client.defaultQueryOptions.bind(client)
  const mutationDefaults = client.defaultMutationOptions.bind(client)
  client.defaultQueryOptions = ((options: Parameters<QueryClient['defaultQueryOptions']>[0]) => {
    const defaulted = queryDefaults(options)
    const answer = () => answers(defaulted.queryKey)
    return {
      ...defaulted,
      queryFn: async () => {
        const data = answer()
        if (data === undefined) throw new Error(NOTHING_SENT)
        return data
      },
      initialData: defaulted.initialData ?? answer,
      staleTime: Infinity,
      retry: false,
      refetchInterval: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    }
  }) as QueryClient['defaultQueryOptions']
  client.defaultMutationOptions = ((options) => ({
    ...mutationDefaults(options),
    mutationFn: () => Promise.reject(new Error(NOTHING_SENT)),
  })) as QueryClient['defaultMutationOptions']
  return client
}

/** Whether a query key starts with these parts. */
function startsWith(key: QueryKey, ...parts: readonly unknown[]): boolean {
  return parts.every((part, index) => key[index] === part)
}

/** An infinite query's data: the one page, at its first page number. */
const onePage = <T,>(page: T, first: unknown) => ({ pages: [page], pageParams: [first] })

/** Every board open to posts and votes, as a signed-out visitor finds them. */
const everyoneVotes = (boards: ReadonlyArray<{ id: string }>) =>
  Object.fromEntries(boards.map((board) => [board.id, { canSubmit: true, canVote: true }]))

/** What each query the sample's page asks reads, from the sample alone. */
export function sampleAnswers(sample: SampleContent): Answers {
  if (sample.page === 'feedback') {
    const data = sample.feedback
    const posts = data.posts.items.map((post) => ({
      ...post,
      content: post.content ?? '',
      createdAt: new Date(post.createdAt),
    }))
    const feed = { ...data, posts: { ...data.posts, items: posts } }
    return (key) => {
      if (startsWith(key, 'portal', 'data')) return feed
      if (startsWith(key, 'portal', 'boards', 'capabilities'))
        return { permissions: data.boardPermissions, boards: [] }
      if (startsWith(key, 'portal', 'boards')) return data.boards
      if (startsWith(key, 'portal', 'statuses')) return data.statuses
      if (startsWith(key, 'portal', 'tags')) return data.tags
      if (startsWith(key, 'portal', 'avatars')) return {}
      if (startsWith(key, 'publicPosts', 'list'))
        return onePage({ items: posts, hasMore: false }, 1)
      if (startsWith(key, 'votedPosts')) return new Set<string>()
      return undefined
    }
  }
  if (sample.page === 'roadmap') {
    const data = sample.roadmap
    return (key) => {
      if (startsWith(key, 'portal', 'roadmaps')) return data.roadmaps
      if (startsWith(key, 'portal', 'boards', 'capabilities'))
        return { permissions: everyoneVotes(data.boards), boards: [] }
      if (startsWith(key, 'portal', 'roadmapPosts')) {
        const column = data.columns[String(key[3])]
        return column && onePage(column, 0)
      }
      if (startsWith(key, 'portal', 'boards')) return data.boards
      if (startsWith(key, 'portal', 'statuses')) return data.statuses
      if (startsWith(key, 'portal', 'tags')) return data.tags
      if (startsWith(key, 'votedPosts')) return new Set<string>()
      return undefined
    }
  }
  if (sample.page === 'changelog') {
    const data = sample.changelog
    return (key) => {
      if (startsWith(key, 'changelogs', 'public', 'list'))
        return onePage({ items: data.entries, nextCursor: null, hasMore: false }, undefined)
      if (startsWith(key, 'changelogs', 'categories')) return data.categories
      return undefined
    }
  }
  return () => undefined
}

/** The sample's page, drawn with every query it asks answered from the sample. */
export function SampleQueries({
  sample,
  children,
}: {
  sample: SampleContent
  children: ReactNode
}) {
  const [client] = useState(() => sampleQueryClient(sampleAnswers(sample)))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

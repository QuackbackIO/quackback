import { describe, it, expect, vi } from 'vitest'
import type { PostStatusId } from '@quackback/ids'

// `createServerFn` needs the TanStack Start build transform; stub it so importing
// the module under test only registers the (never-run) handler. The viewer-gated
// resolvers are dynamically imported inside that handler, so they never load here
// — we exercise the pure projection/resolve helpers with injected fakes instead.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = { validator: () => chain, handler: () => chain }
    return chain
  },
}))

import {
  projectPostPreview,
  projectChangelogPreview,
  projectArticlePreview,
  resolveEmbed,
} from '../embeds'
import type { EmbedResolverDeps } from '../embeds'

const sid = (s: string) => s as PostStatusId

const POST_DETAIL = {
  id: 'post_01ktjwt5tyf6br9mw521h13n6n',
  title: 'Dark mode',
  content: 'A native solution would be much appreciated.',
  voteCount: 42,
  statusId: sid('post_status_01abc'),
  board: { name: 'Features', slug: 'features' },
  tags: [{ id: 'tag_1', name: 'Feature', color: '#6366f1' }],
  authorName: 'Marcus Garcia',
  authorAvatarUrl: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
}
const STATUSES = [
  { id: sid('post_status_01abc'), name: 'Planned', color: '#3b82f6' },
  { id: sid('post_status_01xyz'), name: 'Shipped', color: '#22c55e' },
]

// Canonical portal base injected into the projections (the server fn passes
// config.baseUrl). The `url` it yields is the absolute, viewer-shareable link a
// new-tab embed (e.g. in the widget) opens.
const BASE = 'https://feedback.example.com'

describe('projectPostPreview', () => {
  it('projects a post with its resolved status name + color + absolute url', () => {
    expect(projectPostPreview(POST_DETAIL, STATUSES, BASE)).toEqual({
      kind: 'post',
      postId: 'post_01ktjwt5tyf6br9mw521h13n6n',
      title: 'Dark mode',
      excerpt: 'A native solution would be much appreciated.',
      voteCount: 42,
      statusName: 'Planned',
      statusColor: '#3b82f6',
      boardName: 'Features',
      boardSlug: 'features',
      tags: [{ id: 'tag_1', name: 'Feature', color: '#6366f1' }],
      authorName: 'Marcus Garcia',
      authorAvatarUrl: null,
      createdAt: '2026-01-02T03:04:05.000Z',
      url: 'https://feedback.example.com/b/features/posts/post_01ktjwt5tyf6br9mw521h13n6n',
    })
  })
  it('nulls the status fields when the post has no status', () => {
    const r = projectPostPreview({ ...POST_DETAIL, statusId: null }, STATUSES, BASE)
    expect(r.statusName).toBeNull()
    expect(r.statusColor).toBeNull()
  })
  it('nulls the status fields when the status id is not in the taxonomy', () => {
    const r = projectPostPreview(
      { ...POST_DETAIL, statusId: sid('post_status_gone') },
      STATUSES,
      BASE
    )
    expect(r.statusName).toBeNull()
    expect(r.statusColor).toBeNull()
  })
  it('joins the post url cleanly when the base has a trailing slash', () => {
    const r = projectPostPreview(POST_DETAIL, STATUSES, 'https://feedback.example.com/')
    expect(r.url).toBe(
      'https://feedback.example.com/b/features/posts/post_01ktjwt5tyf6br9mw521h13n6n'
    )
  })
})

describe('projectChangelogPreview', () => {
  it('projects a changelog entry with an ISO publishedAt + absolute url', () => {
    expect(
      projectChangelogPreview(
        {
          id: 'changelog_01ktjwt5tyf6br9mwcz1vskk44',
          title: 'v2 is here',
          publishedAt: new Date('2026-01-02T03:04:05.000Z'),
        },
        BASE
      )
    ).toEqual({
      kind: 'changelog',
      entryId: 'changelog_01ktjwt5tyf6br9mwcz1vskk44',
      title: 'v2 is here',
      publishedAt: '2026-01-02T03:04:05.000Z',
      url: 'https://feedback.example.com/changelog/changelog_01ktjwt5tyf6br9mwcz1vskk44',
    })
  })
  it('tolerates a null publishedAt', () => {
    expect(
      projectChangelogPreview({ id: 'changelog_x', title: 't', publishedAt: null }, BASE)
        .publishedAt
    ).toBeNull()
  })
})

describe('resolveEmbed', () => {
  const baseDeps: EmbedResolverDeps = {
    getPostDetail: async () => POST_DETAIL,
    listStatuses: async () => STATUSES,
    getChangelog: async () => ({
      id: 'changelog_01ktjwt5tyf6br9mwcz1vskk44',
      title: 'v2 is here',
      publishedAt: new Date('2026-01-02T03:04:05.000Z'),
    }),
    getArticle: async () => null,
  }
  const actor = {} as never

  it('resolves a post happy path through the injected resolvers', async () => {
    const r = await resolveEmbed('post', POST_DETAIL.id, actor, baseDeps, BASE)
    expect(r).toMatchObject({
      kind: 'post',
      title: 'Dark mode',
      statusName: 'Planned',
      url: 'https://feedback.example.com/b/features/posts/post_01ktjwt5tyf6br9mw521h13n6n',
    })
  })
  it('resolves a changelog happy path through the injected resolver', async () => {
    const r = await resolveEmbed(
      'changelog',
      'changelog_01ktjwt5tyf6br9mwcz1vskk44',
      actor,
      baseDeps,
      BASE
    )
    expect(r).toMatchObject({
      kind: 'changelog',
      title: 'v2 is here',
      url: 'https://feedback.example.com/changelog/changelog_01ktjwt5tyf6br9mwcz1vskk44',
    })
  })
  it('returns unavailable when the post resolver yields null', async () => {
    const r = await resolveEmbed(
      'post',
      POST_DETAIL.id,
      actor,
      {
        ...baseDeps,
        getPostDetail: async () => null,
      },
      BASE
    )
    expect(r).toEqual({ unavailable: true })
  })
  it('returns unavailable (no exception escapes) when the post resolver throws', async () => {
    const r = await resolveEmbed(
      'post',
      POST_DETAIL.id,
      actor,
      {
        ...baseDeps,
        getPostDetail: async () => {
          throw new Error('gated')
        },
      },
      BASE
    )
    expect(r).toEqual({ unavailable: true })
  })
  it('returns unavailable when the changelog resolver throws not-found', async () => {
    const r = await resolveEmbed(
      'changelog',
      'changelog_x',
      actor,
      {
        ...baseDeps,
        getChangelog: async () => {
          throw new Error('not found')
        },
      },
      BASE
    )
    expect(r).toEqual({ unavailable: true })
  })
})

// ---------------------------------------------------------------------------
// Article embed
// ---------------------------------------------------------------------------

const ARTICLE_INPUT = {
  slug: 'how-to-reset-password',
  title: 'How to reset your password',
  content: 'To reset your password, click Forgot password on the login page.',
  description: null as string | null,
  category: { slug: 'getting-started' },
}

describe('projectArticlePreview', () => {
  it('projects an article with title, excerpt, and absolute url', () => {
    expect(projectArticlePreview(ARTICLE_INPUT, BASE)).toEqual({
      kind: 'article',
      articleId: 'how-to-reset-password',
      categorySlug: 'getting-started',
      title: 'How to reset your password',
      excerpt: 'To reset your password, click Forgot password on the login page.',
      url: 'https://feedback.example.com/hc/articles/getting-started/how-to-reset-password',
    })
  })

  it('uses description as excerpt when content is absent', () => {
    const r = projectArticlePreview(
      { ...ARTICLE_INPUT, content: '', description: 'A short summary.' },
      BASE
    )
    expect(r.excerpt).toBe('A short summary.')
  })

  it('nulls excerpt when both content and description are absent', () => {
    const r = projectArticlePreview({ ...ARTICLE_INPUT, content: '', description: null }, BASE)
    expect(r.excerpt).toBeNull()
  })

  it('joins the article url cleanly when the base has a trailing slash', () => {
    const r = projectArticlePreview(ARTICLE_INPUT, 'https://feedback.example.com/')
    expect(r.url).toBe(
      'https://feedback.example.com/hc/articles/getting-started/how-to-reset-password'
    )
  })
})

describe('resolveEmbed — article', () => {
  const actor = {} as never
  const articleDeps: EmbedResolverDeps = {
    getPostDetail: async () => POST_DETAIL,
    listStatuses: async () => STATUSES,
    getChangelog: async () => ({
      id: 'changelog_01ktjwt5tyf6br9mwcz1vskk44',
      title: 'v2 is here',
      publishedAt: new Date('2026-01-02T03:04:05.000Z'),
    }),
    getArticle: async () => ARTICLE_INPUT,
  }

  it('resolves an article happy path through the injected resolver', async () => {
    const r = await resolveEmbed('article', 'how-to-reset-password', actor, articleDeps, BASE)
    expect(r).toMatchObject({
      kind: 'article',
      title: 'How to reset your password',
      url: 'https://feedback.example.com/hc/articles/getting-started/how-to-reset-password',
    })
  })

  it('returns unavailable when the article resolver yields null', async () => {
    const r = await resolveEmbed(
      'article',
      'unknown-slug',
      actor,
      { ...articleDeps, getArticle: async () => null },
      BASE
    )
    expect(r).toEqual({ unavailable: true })
  })

  it('returns unavailable (no exception escapes) when the article resolver throws', async () => {
    const r = await resolveEmbed(
      'article',
      'slug',
      actor,
      {
        ...articleDeps,
        getArticle: async () => {
          throw new Error('private')
        },
      },
      BASE
    )
    expect(r).toEqual({ unavailable: true })
  })
})

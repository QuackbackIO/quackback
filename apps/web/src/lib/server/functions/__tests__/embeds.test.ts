import { describe, it, expect, vi } from 'vitest'
import type { StatusId } from '@quackback/ids'

// `createServerFn` needs the TanStack Start build transform; stub it so importing
// the module under test only registers the (never-run) handler. The viewer-gated
// resolvers are dynamically imported inside that handler, so they never load here
// — we exercise the pure projection/resolve helpers with injected fakes instead.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = { inputValidator: () => chain, handler: () => chain }
    return chain
  },
}))

import { projectPostPreview, projectChangelogPreview, resolveEmbed } from '../embeds'
import type { EmbedResolverDeps } from '../embeds'

const sid = (s: string) => s as StatusId

const POST_DETAIL = {
  id: 'post_01ktjwt5tyf6br9mw521h13n6n',
  title: 'Dark mode',
  content: 'A native solution would be much appreciated.',
  voteCount: 42,
  statusId: sid('status_01abc'),
  board: { name: 'Features', slug: 'features' },
  tags: [{ id: 'tag_1', name: 'Feature', color: '#6366f1' }],
  authorName: 'Marcus Garcia',
  authorAvatarUrl: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
}
const STATUSES = [
  { id: sid('status_01abc'), name: 'Planned', color: '#3b82f6' },
  { id: sid('status_01xyz'), name: 'Shipped', color: '#22c55e' },
]

describe('projectPostPreview', () => {
  it('projects a post with its resolved status name + color', () => {
    expect(projectPostPreview(POST_DETAIL, STATUSES)).toEqual({
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
    })
  })
  it('nulls the status fields when the post has no status', () => {
    const r = projectPostPreview({ ...POST_DETAIL, statusId: null }, STATUSES)
    expect(r.statusName).toBeNull()
    expect(r.statusColor).toBeNull()
  })
  it('nulls the status fields when the status id is not in the taxonomy', () => {
    const r = projectPostPreview({ ...POST_DETAIL, statusId: sid('status_gone') }, STATUSES)
    expect(r.statusName).toBeNull()
    expect(r.statusColor).toBeNull()
  })
})

describe('projectChangelogPreview', () => {
  it('projects a changelog entry with an ISO publishedAt', () => {
    expect(
      projectChangelogPreview({
        id: 'changelog_01ktjwt5tyf6br9mwcz1vskk44',
        title: 'v2 is here',
        publishedAt: new Date('2026-01-02T03:04:05.000Z'),
      })
    ).toEqual({
      kind: 'changelog',
      entryId: 'changelog_01ktjwt5tyf6br9mwcz1vskk44',
      title: 'v2 is here',
      publishedAt: '2026-01-02T03:04:05.000Z',
    })
  })
  it('tolerates a null publishedAt', () => {
    expect(
      projectChangelogPreview({ id: 'changelog_x', title: 't', publishedAt: null }).publishedAt
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
  }
  const actor = {} as never

  it('resolves a post happy path through the injected resolvers', async () => {
    const r = await resolveEmbed('post', POST_DETAIL.id, actor, baseDeps)
    expect(r).toMatchObject({ kind: 'post', title: 'Dark mode', statusName: 'Planned' })
  })
  it('resolves a changelog happy path through the injected resolver', async () => {
    const r = await resolveEmbed(
      'changelog',
      'changelog_01ktjwt5tyf6br9mwcz1vskk44',
      actor,
      baseDeps
    )
    expect(r).toMatchObject({ kind: 'changelog', title: 'v2 is here' })
  })
  it('returns unavailable when the post resolver yields null', async () => {
    const r = await resolveEmbed('post', POST_DETAIL.id, actor, {
      ...baseDeps,
      getPostDetail: async () => null,
    })
    expect(r).toEqual({ unavailable: true })
  })
  it('returns unavailable (no exception escapes) when the post resolver throws', async () => {
    const r = await resolveEmbed('post', POST_DETAIL.id, actor, {
      ...baseDeps,
      getPostDetail: async () => {
        throw new Error('gated')
      },
    })
    expect(r).toEqual({ unavailable: true })
  })
  it('returns unavailable when the changelog resolver throws not-found', async () => {
    const r = await resolveEmbed('changelog', 'changelog_x', actor, {
      ...baseDeps,
      getChangelog: async () => {
        throw new Error('not found')
      },
    })
    expect(r).toEqual({ unavailable: true })
  })
})

/**
 * Entity serializers: the pure row -> archive-line mapping for each core
 * entity, plus the users exporter's stateful users -> leads paging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  listPortalUsers: vi.fn(),
}))

// fetchPage implementations hit the db; only serialize/paging logic is under
// test here, so the db module and directory services are stubbed out.
vi.mock('@/lib/server/db', () => ({
  db: {},
  boards: {},
  postStatuses: {},
  postTags: {},
  posts: {},
  postComments: {},
  postVotes: {},
  principal: {},
  user: {},
  changelogEntries: {},
  helpCenterArticles: {},
  conversations: {},
  conversationMessages: {},
  ticketConversations: {},
  eq: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  lt: vi.fn(),
}))

vi.mock('@/lib/server/domains/users/user.service', () => ({
  listPortalUsers: hoisted.listPortalUsers,
}))

vi.mock('@/lib/server/domains/companies', () => ({
  listCompanies: vi.fn(),
}))

import { boardsExporter } from '../entities/taxonomy'
import { postsExporter } from '../entities/posts'
import { commentsExporter } from '../entities/comments'
import { votesExporter } from '../entities/votes'
import { createUsersExporter } from '../entities/users'
import { companiesExporter } from '../entities/companies'
import { conversationsExporter } from '../entities/conversations'
import { kbArticlesExporter } from '../entities/kb'

const d = (iso: string) => new Date(iso)

describe('postsExporter.serialize', () => {
  const row = {
    id: 'post_1',
    title: 'Dark mode',
    content: 'Please add it, "everyone" wants it',
    statusName: 'Planned',
    tags: [{ tag: { name: 'ui' } }, { tag: { name: 'theme' } }],
    board: { slug: 'feedback' },
    author: { displayName: 'Ada', user: { email: 'ada@example.com' } },
    voteCount: 42,
    createdAt: d('2026-07-01T10:00:00Z'),
  }

  it('renders a CSV row with tags, status, and author', () => {
    expect(postsExporter.serialize(row as never)).toBe(
      'post_1,"Dark mode","Please add it, ""everyone"" wants it","Planned","ui,theme","feedback","Ada","ada@example.com",42,2026-07-01T10:00:00.000Z'
    )
  })

  it('guards against spreadsheet formula injection', () => {
    const evil = { ...row, title: '=HYPERLINK("https://evil.example")' }
    expect(postsExporter.serialize(evil as never)).toContain(`'=HYPERLINK`)
  })

  it('blanks synthetic anonymous author emails', () => {
    const anon = {
      ...row,
      author: { displayName: 'anon', user: { email: 'temp-123@anon.quackback.io' } },
    }
    const line = postsExporter.serialize(anon as never)
    expect(line).not.toContain('anon.quackback.io')
  })
})

describe('commentsExporter.serialize', () => {
  it('renders parent ids and moderation state', () => {
    const line = commentsExporter.serialize({
      id: 'post_comment_1',
      postId: 'post_1',
      parentId: 'post_comment_0',
      author: { displayName: 'Grace', user: { email: 'grace@example.com' } },
      isTeamMember: true,
      isPrivate: false,
      moderationState: 'published',
      content: 'first!',
      createdAt: d('2026-07-02T08:00:00Z'),
      updatedAt: null,
    } as never)
    expect(line).toBe(
      'post_comment_1,post_1,post_comment_0,"Grace","grace@example.com",true,false,published,"first!",2026-07-02T08:00:00.000Z,'
    )
  })
})

describe('votesExporter.serialize', () => {
  it('renders the resolved voter email', () => {
    const line = votesExporter.serialize({
      id: 'post_vote_1',
      postId: 'post_1',
      voterEmail: 'voter@example.com',
      sourceType: 'zendesk',
      createdAt: d('2026-07-03T12:00:00Z'),
    } as never)
    expect(line).toBe('post_vote_1,post_1,"voter@example.com","zendesk",2026-07-03T12:00:00.000Z')
  })
})

describe('companiesExporter.serialize', () => {
  it('formats monthly spend from cents', () => {
    const line = companiesExporter.serialize({
      name: 'Acme, Inc.',
      domain: 'acme.example',
      externalId: 'crm_1',
      plan: 'enterprise',
      mrrCents: 123456,
      memberCount: 7,
      createdAt: d('2026-07-04T00:00:00Z'),
    } as never)
    expect(line).toBe(
      '"Acme, Inc.","acme.example","crm_1","enterprise",1234.56,7,2026-07-04T00:00:00.000Z'
    )
  })
})

describe('conversationsExporter.serialize', () => {
  it('renders one JSON line per conversation', () => {
    const row = {
      id: 'conversation_1',
      status: 'open',
      channel: 'widget',
      createdAt: '2026-07-05T00:00:00.000Z',
      visitorEmail: 'visitor@example.com',
      tickets: [{ id: 'ticket_1', type: 'bug' }],
      messages: [
        {
          id: 'conversation_message_1',
          senderType: 'visitor',
          content: 'hi',
          isInternal: false,
          createdAt: '2026-07-05T00:01:00.000Z',
        },
      ],
    }
    const line = conversationsExporter.serialize(row as never)
    expect(JSON.parse(line)).toEqual(row)
    expect(line).not.toContain('\n')
  })
})

describe('kbArticlesExporter.serialize', () => {
  it('renders the category slug', () => {
    const line = kbArticlesExporter.serialize({
      id: 'kb_article_1',
      category: { slug: 'getting-started' },
      slug: 'install',
      title: 'Install the widget',
      description: null,
      content: 'npm i quackback',
      publishedAt: d('2026-07-06T00:00:00Z'),
      viewCount: 10,
      helpfulCount: 3,
      notHelpfulCount: 1,
      createdAt: d('2026-07-06T00:00:00Z'),
    } as never)
    expect(line).toContain('kb_article_1,"getting-started","install","Install the widget"')
  })
})

describe('boardsExporter / headers', () => {
  it('every entity declares a manifest key and archive file name', () => {
    for (const entity of [
      boardsExporter,
      postsExporter,
      commentsExporter,
      votesExporter,
      createUsersExporter(),
      companiesExporter,
      conversationsExporter,
      kbArticlesExporter,
    ]) {
      expect(entity.key).toBeTruthy()
      expect(entity.fileName).toMatch(/\.(csv|jsonl)$/)
    }
  })
})

describe('users exporter paging (users -> leads)', () => {
  beforeEach(() => {
    hoisted.listPortalUsers.mockReset()
  })

  const user = (email: string, isLead = false) => ({
    name: 'N',
    email,
    contactEmail: null,
    emailVerified: true,
    isLead,
    segments: [],
    joinedAt: d('2026-07-01T00:00:00Z'),
    lastSeenAt: null,
    postCount: 0,
    commentCount: 0,
    voteCount: 0,
  })

  it('fills pages across the users/leads boundary and stops when exhausted', async () => {
    const exporter = createUsersExporter()
    // 3 users then 2 leads with a page size of 4: the first page crosses the
    // boundary (the second service call tops up with limit 1).
    hoisted.listPortalUsers
      .mockResolvedValueOnce({
        items: [user('u1'), user('u2'), user('u3')],
        total: 3,
        hasMore: false,
      })
      .mockResolvedValueOnce({ items: [user('l1', true)], total: 2, hasMore: true })
      .mockResolvedValueOnce({ items: [user('l2', true)], total: 2, hasMore: false })

    const page1 = await exporter.fetchPage(0, 4)
    expect(page1.map((u) => u.email)).toEqual(['u1', 'u2', 'u3', 'l1'])
    expect(hoisted.listPortalUsers).toHaveBeenNthCalledWith(1, {
      lifecycle: 'users',
      page: 1,
      limit: 4,
    })
    expect(hoisted.listPortalUsers).toHaveBeenNthCalledWith(2, {
      lifecycle: 'leads',
      page: 1,
      limit: 1,
    })

    const page2 = await exporter.fetchPage(4, 4)
    expect(page2.map((u) => u.email)).toEqual(['l2'])
    // Short page = entity exhausted; orchestrator stops here.
    expect(page2.length).toBeLessThan(4)
  })

  it('skips users entirely when there are none', async () => {
    const exporter = createUsersExporter()
    hoisted.listPortalUsers
      .mockResolvedValueOnce({ items: [], total: 0, hasMore: false })
      .mockResolvedValueOnce({ items: [user('l1', true)], total: 1, hasMore: false })

    const page = await exporter.fetchPage(0, 4)
    expect(page.map((u) => u.email)).toEqual(['l1'])
  })

  it('serializes leads with the lifecycle column', () => {
    const line = createUsersExporter().serialize(user('l1', true) as never)
    expect(line).toContain('true,lead,')
  })
})

import { describe, expect, it } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'
import {
  MCP_SERVER_INSTRUCTIONS,
  UNTRUSTED_NOTE,
  markUntrusted,
  untrustedFields,
  withItemFacts,
  type UntrustedSpec,
} from '../untrusted'

const textResult = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] })

describe('untrustedFields', () => {
  it('lists a key path only when it holds text', () => {
    const spec: UntrustedSpec = ['title', 'content', 'authorName', 'summary', 'missing']
    expect(
      untrustedFields(spec, { title: 'Hi', content: '', authorName: null, summary: { a: 1 } })
    ).toEqual(['title', 'summary'])
  })

  it('treats an empty list as holding no text', () => {
    expect(untrustedFields(['reactors'], { reactors: [] })).toEqual([])
    expect(untrustedFields(['reactors'], { reactors: ['Ada'] })).toEqual(['reactors'])
  })

  it('lists a wildcard path when any item holds text there', () => {
    const spec: UntrustedSpec = ['posts[].title', 'posts[].summary']
    expect(
      untrustedFields(spec, {
        posts: [
          { title: 'A', summary: null },
          { title: 'B', summary: null },
        ],
      })
    ).toEqual(['posts[].title'])
    expect(untrustedFields(spec, { posts: [] })).toEqual([])
  })

  it('walks nested objects and nested wildcards', () => {
    expect(
      untrustedFields(['conversation.subject', 'changelogs[].linkedPosts[].title'], {
        conversation: { subject: 'Refund' },
        changelogs: [{ linkedPosts: [] }, { linkedPosts: [{ title: 'Webhooks' }] }],
      })
    ).toEqual(['conversation.subject', 'changelogs[].linkedPosts[].title'])
  })

  it('ignores paths whose shape does not match the result', () => {
    expect(
      untrustedFields(['posts[].title', 'conversation.subject'], {
        posts: { title: 'not an array' },
        conversation: 'not an object',
      })
    ).toEqual([])
  })

  it('indexes the items a per-item rule accepts, and recurses into nested items', () => {
    const spec: UntrustedSpec = [
      {
        each: 'comments',
        where: (comment) => comment.isTeamMember !== true,
        fields: ['content', 'authorName'],
        nested: 'replies',
      },
    ]
    expect(
      untrustedFields(spec, {
        comments: [
          {
            isTeamMember: false,
            content: 'customer',
            authorName: null,
            replies: [
              { isTeamMember: true, content: 'team', authorName: 'Jane', replies: [] },
              { isTeamMember: false, content: 'customer again', authorName: 'Bo', replies: [] },
            ],
          },
          { isTeamMember: true, content: 'team', authorName: 'Jane', replies: [] },
        ],
      })
    ).toEqual([
      'comments[0].content',
      'comments[0].replies[1].content',
      'comments[0].replies[1].authorName',
    ])
  })

  it('applies variant rules only to results they match', () => {
    const kind = (value: string) => (result: Record<string, unknown>) => result.kind === value
    const spec: UntrustedSpec = [
      { match: kind('post'), rules: ['title'] },
      { match: kind('changelog'), rules: ['linkedPosts[].title'] },
    ]
    expect(untrustedFields(spec, { kind: 'post', title: 'Hi', linkedPosts: [] })).toEqual(['title'])
    expect(
      untrustedFields(spec, { kind: 'changelog', title: 'Team', linkedPosts: [{ title: 'Hi' }] })
    ).toEqual(['linkedPosts[].title'])
    expect(untrustedFields(spec, { kind: 'article', title: 'Team' })).toEqual([])
  })

  it('lists each path once, in declaration order', () => {
    expect(untrustedFields(['b', 'a', 'b'], { a: 'x', b: 'y' })).toEqual(['b', 'a'])
  })
})

describe('markUntrusted', () => {
  it('appends the descriptor as the last key of a pretty body, leaving the rest byte for byte', () => {
    const before = JSON.stringify({ id: 'post_1', title: 'Hi "there"\nnext', votes: 3 }, null, 2)
    const marked = markUntrusted(textResult(before), ['title'])
    const text = (marked.content[0] as { text: string }).text

    expect(text).toBe(
      JSON.stringify(
        {
          id: 'post_1',
          title: 'Hi "there"\nnext',
          votes: 3,
          untrusted: { note: UNTRUSTED_NOTE, fields: ['title'] },
        },
        null,
        2
      )
    )
    expect(text.startsWith(before.slice(0, -2))).toBe(true)
  })

  it('keeps a compact body compact', () => {
    const before = JSON.stringify({ posts: [{ title: 'émoji 👍 <b>' }], hasMore: false })
    const text = (
      markUntrusted(textResult(before), ['posts[].title']).content[0] as {
        text: string
      }
    ).text
    expect(text).toBe(
      JSON.stringify({
        posts: [{ title: 'émoji 👍 <b>' }],
        hasMore: false,
        untrusted: { note: UNTRUSTED_NOTE, fields: ['posts[].title'] },
      })
    )
  })

  it('returns the same result when nothing outside-authored is present', () => {
    const result = textResult(JSON.stringify({ title: '' }))
    expect(markUntrusted(result, ['title'])).toBe(result)
  })

  it('returns the same result for tools that declare none', () => {
    const result = textResult(JSON.stringify({ title: 'Team text' }))
    expect(markUntrusted(result, [])).toBe(result)
  })

  it('leaves error results and non-JSON text alone', () => {
    const error: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'Error: nope' }],
    }
    expect(markUntrusted(error, ['title'])).toBe(error)
    const plain = textResult('Help center is not enabled.')
    expect(markUntrusted(plain, ['title'])).toBe(plain)
    const list = textResult(JSON.stringify([{ title: 'x' }]))
    expect(markUntrusted(list, ['title'])).toBe(list)
  })
})

describe('item facts', () => {
  const offTeam = (_object: Record<string, unknown>, facts?: Record<string, unknown>) =>
    facts?.onTeam !== true
  const fieldsOf = (result: CallToolResult, spec: UntrustedSpec) =>
    JSON.parse((markUntrusted(result, spec).content[0] as { text: string }).text).untrusted?.fields

  it('gives top-level and nested items the facts at their path, never serializing them', () => {
    const spec: UntrustedSpec = [
      { each: 'rows', where: offTeam, fields: ['name'], nested: 'children' },
    ]
    const body = {
      rows: [
        { name: 'Jane', children: [{ name: 'Former', children: [] }] },
        { name: 'Ada', children: [{ name: 'Bo', children: [] }] },
      ],
    }
    const result = withItemFacts(textResult(JSON.stringify(body)), {
      'rows[0]': { onTeam: true },
      'rows[0].children[0]': { onTeam: false },
      'rows[1]': { onTeam: false },
      'rows[1].children[0]': { onTeam: true },
    })

    expect(fieldsOf(result, spec)).toEqual(['rows[0].children[0].name', 'rows[1].name'])
    expect(JSON.stringify(markUntrusted(result, spec))).not.toContain('onTeam')
  })

  it('keeps facts from every source about one object', () => {
    const spec: UntrustedSpec = [
      {
        at: 'author',
        where: (_o, facts) => facts?.onTeam !== true || facts?.verified !== true,
        fields: ['name'],
      },
    ]
    const result = textResult(JSON.stringify({ author: { name: 'Jane' } }))
    withItemFacts(result, { author: { onTeam: true } })
    withItemFacts(result, { author: { verified: true } })

    expect(fieldsOf(result, spec)).toBeUndefined()
  })

  it('applies an object rule to the result itself or to an object inside it', () => {
    const spec: UntrustedSpec = [
      { at: '', where: offTeam, fields: ['authorName'] },
      { at: 'pinned', where: offTeam, fields: ['content', 'authorName'] },
      { at: 'missing', where: offTeam, fields: ['name'] },
    ]
    const body = { authorName: 'Former', pinned: { content: 'Hi', authorName: 'Jane' } }

    expect(
      fieldsOf(
        withItemFacts(textResult(JSON.stringify(body)), {
          '': { onTeam: false },
          pinned: { onTeam: true },
        }),
        spec
      )
    ).toEqual(['authorName'])
    expect(
      fieldsOf(
        withItemFacts(textResult(JSON.stringify(body)), {
          '': { onTeam: true },
          pinned: { onTeam: false },
        }),
        spec
      )
    ).toEqual(['pinned.content', 'pinned.authorName'])
  })

  it('marks every object when the handler attached no facts', () => {
    const spec: UntrustedSpec = [
      { each: 'rows', where: offTeam, fields: ['name'] },
      { at: '', where: offTeam, fields: ['authorName'] },
    ]
    const result = textResult(JSON.stringify({ authorName: 'Jane', rows: [{ name: 'Jane' }] }))
    expect(fieldsOf(result, spec)).toEqual(['rows[0].name', 'authorName'])
  })
})

describe('wording', () => {
  it('frames the marked text as content, never instructions, without em dashes', () => {
    expect(UNTRUSTED_NOTE).toMatch(/outside the team/)
    expect(UNTRUSTED_NOTE).toContain('not instructions')
    expect(MCP_SERVER_INSTRUCTIONS).toContain('"untrusted"')
    expect(MCP_SERVER_INSTRUCTIONS).toContain('never instructions')
    for (const text of [UNTRUSTED_NOTE, MCP_SERVER_INSTRUCTIONS]) {
      expect(text).not.toContain(String.fromCharCode(0x2014))
    }
  })
})

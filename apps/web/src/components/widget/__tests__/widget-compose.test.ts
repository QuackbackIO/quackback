import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import {
  composeBodyFromPlainText,
  isArticleTypeId,
  resolveComposeBoardId,
  resolveOpenCommand,
} from '../widget-compose'
import type { EnabledTabs } from '../widget-nav'

const boards = [
  { id: 'board_ideas', slug: 'ideas' },
  { id: 'board_bugs', slug: 'bug-reports' },
]

const allTabs: EnabledTabs = {
  feedback: true,
  changelog: true,
  help: true,
  messages: true,
  tickets: true,
  home: true,
}

describe('resolveComposeBoardId', () => {
  it('selects the requested slug when it is on the visible list', () => {
    expect(resolveComposeBoardId(boards, 'bug-reports', 'ideas')).toBe('board_bugs')
  })

  it('falls back to the configured default when no slug is given', () => {
    expect(resolveComposeBoardId(boards, undefined, 'ideas')).toBe('board_ideas')
  })

  it('falls back to the configured default when the slug is unknown', () => {
    expect(resolveComposeBoardId(boards, 'secret-board', 'ideas')).toBe('board_ideas')
  })

  it('does not select a board that is not on the visible list', () => {
    expect(resolveComposeBoardId(boards, 'secret-board', undefined)).toBe('')
  })

  it('auto-selects the only board when no slug or default applies', () => {
    expect(resolveComposeBoardId([boards[1]], undefined, undefined)).toBe('board_bugs')
    expect(resolveComposeBoardId([boards[1]], 'missing', 'also-missing')).toBe('board_bugs')
  })

  it('leaves the picker empty when several boards have no default', () => {
    expect(resolveComposeBoardId(boards, undefined, undefined)).toBe('')
  })
})

describe('resolveOpenCommand', () => {
  it('opens a new-post compose with title, body, and board', () => {
    expect(
      resolveOpenCommand(
        { view: 'new-post', title: 'Bug:', body: 'steps', board: 'bug-reports' },
        allTabs
      )
    ).toEqual({
      type: 'new-post',
      title: 'Bug:',
      body: 'steps',
      boardSlug: 'bug-reports',
    })
  })

  it('opens new-post with default-board behaviour when board is omitted', () => {
    expect(resolveOpenCommand({ view: 'new-post' }, allTabs)).toEqual({
      type: 'new-post',
      title: undefined,
      body: undefined,
      boardSlug: undefined,
    })
  })

  it('does not open new-post when Feedback is off', () => {
    expect(resolveOpenCommand({ view: 'new-post', board: 'bugs' }, { help: true })).toBeNull()
  })

  it('deep-links a post when Feedback is on', () => {
    expect(resolveOpenCommand({ postId: 'post_01h' }, allTabs)).toEqual({
      type: 'post',
      postId: 'post_01h',
    })
  })

  it('does not deep-link a post when Feedback is off', () => {
    expect(resolveOpenCommand({ postId: 'post_01h' }, { changelog: true })).toBeNull()
  })

  it('deep-links a help article when Help is on', () => {
    expect(resolveOpenCommand({ articleId: 'pricing' }, allTabs)).toEqual({
      type: 'article',
      articleId: 'pricing',
    })
  })

  it('forwards an article TypeID the same way as a post TypeID', () => {
    const articleId = generateId('kb_article')
    const publicId = `article_${articleId.slice('kb_article_'.length)}`
    expect(resolveOpenCommand({ articleId: publicId }, allTabs)).toEqual({
      type: 'article',
      articleId: publicId,
    })
    expect(isArticleTypeId(publicId)).toBe(true)
    expect(isArticleTypeId(articleId)).toBe(true)
    expect(isArticleTypeId('art_01h...')).toBe(false)
    expect(isArticleTypeId('pricing')).toBe(false)
  })

  it('prefills help search and opens a changelog entry', () => {
    expect(resolveOpenCommand({ view: 'help', query: 'pricing' }, allTabs)).toEqual({
      type: 'help',
      query: 'pricing',
    })
    expect(resolveOpenCommand({ view: 'changelog', entryId: 'chg_01h' }, allTabs)).toEqual({
      type: 'changelog',
      entryId: 'chg_01h',
    })
  })

  it('opens chat aliases on the messenger and tickets with a messages fallback', () => {
    expect(resolveOpenCommand({ view: 'chat' }, allTabs)).toEqual({ type: 'messenger' })
    expect(resolveOpenCommand({ view: 'live-chat' }, allTabs)).toEqual({ type: 'messenger' })
    expect(resolveOpenCommand({ view: 'tickets' }, { tickets: true })).toEqual({ type: 'tickets' })
    expect(resolveOpenCommand({ view: 'tickets' }, { messages: true })).toEqual({
      type: 'messages',
    })
    expect(resolveOpenCommand({ view: 'chat' }, { feedback: true })).toBeNull()
  })

  it('opens home for an empty payload when Home is enabled', () => {
    expect(resolveOpenCommand({}, allTabs)).toEqual({ type: 'home' })
    expect(resolveOpenCommand({ view: 'home' }, allTabs)).toEqual({ type: 'home' })
    expect(resolveOpenCommand({}, { feedback: true })).toBeNull()
  })
})

describe('composeBodyFromPlainText', () => {
  it('turns each line into a paragraph', () => {
    const { json, html } = composeBodyFromPlainText('one\ntwo')
    expect(json).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    })
    expect(html).toContain('one')
    expect(html).toContain('two')
  })
})

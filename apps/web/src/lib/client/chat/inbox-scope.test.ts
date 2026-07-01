import { describe, it, expect } from 'vitest'
import type { ConversationTagId, SegmentId } from '@quackback/ids'
import { navFromSearch, buildListParams, type InboxNavItem } from './inbox-scope'

const tagId = 'chat_tag_x' as ConversationTagId
const segId = 'segment_y' as SegmentId

describe('navFromSearch', () => {
  it('resolves a tag scope', () => {
    expect(navFromSearch({ tag: tagId })).toEqual({ kind: 'tag', tagId })
  })

  it('resolves a segment scope when there is no tag', () => {
    expect(navFromSearch({ segment: segId })).toEqual({ kind: 'segment', segmentId: segId })
  })

  it('prefers tag over segment over view (exclusive precedence)', () => {
    expect(navFromSearch({ tag: tagId, segment: segId, view: 'mine' })).toEqual({
      kind: 'tag',
      tagId,
    })
    expect(navFromSearch({ segment: segId, view: 'mine' })).toEqual({
      kind: 'segment',
      segmentId: segId,
    })
  })

  it('falls back to the view, defaulting to "all"', () => {
    expect(navFromSearch({ view: 'unassigned' })).toEqual({ kind: 'view', view: 'unassigned' })
    expect(navFromSearch({})).toEqual({ kind: 'view', view: 'all' })
  })
})

describe('buildListParams', () => {
  const view = (v: 'mine' | 'unassigned' | 'all' | 'mentions'): InboxNavItem => ({
    kind: 'view',
    view: v,
  })

  it('maps a tag scope to tagIds, carrying status/priority/search', () => {
    expect(buildListParams({ kind: 'tag', tagId }, 'open', 'high', 'refund')).toEqual({
      tagIds: [tagId],
      status: 'open',
      priority: 'high',
      search: 'refund',
    })
  })

  it('maps a segment scope to segmentIds', () => {
    expect(buildListParams({ kind: 'segment', segmentId: segId }, 'closed', 'all', '')).toEqual({
      segmentIds: [segId],
      status: 'closed',
      priority: undefined,
      search: undefined,
    })
  })

  it('maps the mentions view to a self-contained feed (no status/priority/assignee)', () => {
    expect(buildListParams(view('mentions'), 'open', 'high', 'hi')).toEqual({
      view: 'mentions',
      search: 'hi',
    })
  })

  it('maps assignee queues, dropping "all" status/priority to undefined', () => {
    expect(buildListParams(view('mine'), 'all', 'all', '')).toEqual({
      status: undefined,
      priority: undefined,
      assignee: 'mine',
      search: undefined,
    })
    expect(buildListParams(view('unassigned'), 'open', 'all', '')).toEqual({
      status: 'open',
      priority: undefined,
      assignee: 'unassigned',
      search: undefined,
    })
    expect(buildListParams(view('all'), 'open', 'all', '')).toEqual({
      status: 'open',
      priority: undefined,
      assignee: 'all',
      search: undefined,
    })
  })
})

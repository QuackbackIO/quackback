import { describe, it, expect } from 'vitest'
import type {
  ConversationTagId,
  SegmentId,
  CompanyId,
  TeamId,
  ConversationViewId,
} from '@quackback/ids'
import {
  navFromSearch,
  buildListParams,
  buildInboxListParams,
  usesUnifiedInboxList,
  normalizeTriageFacet,
  facetToStatusFilter,
  isTicketInboxView,
  ticketTypeForView,
  inboxNavKey,
  type InboxNavItem,
} from './inbox-scope'

const tagId = 'conversation_tag_x' as ConversationTagId
const segId = 'segment_y' as SegmentId
const companyId = 'company_z' as CompanyId
const teamId = 'team_t' as TeamId
const viewId = 'conversation_view_v' as ConversationViewId

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

  it('resolves team + custom scopes with precedence custom > team > tag', () => {
    expect(navFromSearch({ team: teamId })).toEqual({ kind: 'team', teamId })
    expect(navFromSearch({ viewId })).toEqual({ kind: 'custom', viewId })
    // custom wins over everything; team wins over tag/segment/view.
    expect(navFromSearch({ viewId, team: teamId, tag: tagId })).toEqual({ kind: 'custom', viewId })
    expect(navFromSearch({ team: teamId, tag: tagId, view: 'mine' })).toEqual({
      kind: 'team',
      teamId,
    })
  })
})

describe('inboxNavKey', () => {
  it('namespaces every scope kind so query keys never collide', () => {
    expect(inboxNavKey({ kind: 'view', view: 'all' })).toBe('view:all')
    expect(inboxNavKey({ kind: 'tag', tagId })).toBe(`tag:${tagId}`)
    expect(inboxNavKey({ kind: 'segment', segmentId: segId })).toBe(`segment:${segId}`)
    expect(inboxNavKey({ kind: 'team', teamId })).toBe(`team:${teamId}`)
    expect(inboxNavKey({ kind: 'custom', viewId })).toBe(`custom:${viewId}`)
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

  it('carries the optional company refinement across scopes', () => {
    expect(buildListParams(view('all'), 'open', 'all', '', companyId)).toMatchObject({
      assignee: 'all',
      companyId,
    })
    expect(buildListParams({ kind: 'tag', tagId }, 'open', 'all', '', companyId)).toMatchObject({
      tagIds: [tagId],
      companyId,
    })
  })

  it('carries a non-default sort but omits the implicit "recent" default', () => {
    expect(buildListParams(view('all'), 'open', 'all', '', undefined, 'waiting')).toMatchObject({
      assignee: 'all',
      sort: 'waiting',
    })
    // 'recent' is the server default, so it is dropped to keep params stable.
    expect(
      buildListParams(view('all'), 'open', 'all', '', undefined, 'recent').sort
    ).toBeUndefined()
  })

  it('maps a team scope to a teamId filter', () => {
    expect(buildListParams({ kind: 'team', teamId }, 'open', 'high', 'bug')).toMatchObject({
      teamId,
      status: 'open',
      priority: 'high',
      search: 'bug',
    })
  })

  it('runs a custom view from its pre-translated params (chips ignored)', () => {
    const customParams = {
      status: 'closed' as const,
      waitingOnly: true,
      tagIds: ['conversation_tag_x'],
    }
    // Even though status='open'/priority='high' chips are passed, a custom scope
    // uses ONLY its own rule set (plus search/company/sort).
    expect(
      buildListParams(
        { kind: 'custom', viewId },
        'open',
        'high',
        'refund',
        companyId,
        'oldest',
        customParams
      )
    ).toEqual({
      status: 'closed',
      waitingOnly: true,
      tagIds: ['conversation_tag_x'],
      search: 'refund',
      companyId,
      sort: 'oldest',
    })
  })
})

describe('normalizeTriageFacet', () => {
  it('accepts the canonical facets', () => {
    expect(normalizeTriageFacet('open')).toBe('open')
    expect(normalizeTriageFacet('waiting')).toBe('waiting')
    expect(normalizeTriageFacet('closed')).toBe('closed')
    expect(normalizeTriageFacet('all')).toBe('all')
  })

  it('normalizes the legacy "snoozed" status to "waiting"', () => {
    expect(normalizeTriageFacet('snoozed')).toBe('waiting')
  })

  it('rejects anything else', () => {
    expect(normalizeTriageFacet('bogus')).toBeUndefined()
    expect(normalizeTriageFacet(undefined)).toBeUndefined()
    expect(normalizeTriageFacet(42)).toBeUndefined()
  })
})

describe('facetToStatusFilter', () => {
  it('maps facets back to the legacy conversation StatusFilter shape', () => {
    expect(facetToStatusFilter('open')).toBe('open')
    expect(facetToStatusFilter('waiting')).toBe('snoozed')
    expect(facetToStatusFilter('closed')).toBe('closed')
    expect(facetToStatusFilter('all')).toBe('all')
  })
})

describe('ticket inbox views', () => {
  it('isTicketInboxView recognizes only the three Tickets-section scopes', () => {
    expect(isTicketInboxView('tickets_customer')).toBe(true)
    expect(isTicketInboxView('tickets_back_office')).toBe(true)
    expect(isTicketInboxView('tickets_tracker')).toBe(true)
    expect(isTicketInboxView('mine')).toBe(false)
    expect(isTicketInboxView('quinn')).toBe(false)
  })

  it('ticketTypeForView maps each view to its ticket type', () => {
    expect(ticketTypeForView('tickets_customer')).toBe('customer')
    expect(ticketTypeForView('tickets_back_office')).toBe('back_office')
    expect(ticketTypeForView('tickets_tracker')).toBe('tracker')
  })

  it('navFromSearch resolves a Tickets-section view like any other view', () => {
    expect(navFromSearch({ view: 'tickets_customer' })).toEqual({
      kind: 'view',
      view: 'tickets_customer',
    })
  })
})

describe('usesUnifiedInboxList', () => {
  it('routes mine/unassigned/all and team scopes through the unified endpoint', () => {
    expect(usesUnifiedInboxList({ kind: 'view', view: 'mine' })).toBe(true)
    expect(usesUnifiedInboxList({ kind: 'view', view: 'unassigned' })).toBe(true)
    expect(usesUnifiedInboxList({ kind: 'view', view: 'all' })).toBe(true)
    expect(usesUnifiedInboxList({ kind: 'team', teamId })).toBe(true)
  })

  it('routes every Tickets-section scope through the unified endpoint', () => {
    expect(usesUnifiedInboxList({ kind: 'view', view: 'tickets_customer' })).toBe(true)
    expect(usesUnifiedInboxList({ kind: 'view', view: 'tickets_back_office' })).toBe(true)
    expect(usesUnifiedInboxList({ kind: 'view', view: 'tickets_tracker' })).toBe(true)
  })

  it('keeps mentions/quinn/saved and tag/segment/custom scopes on the legacy endpoint', () => {
    expect(usesUnifiedInboxList({ kind: 'view', view: 'mentions' })).toBe(false)
    expect(usesUnifiedInboxList({ kind: 'view', view: 'quinn' })).toBe(false)
    expect(usesUnifiedInboxList({ kind: 'view', view: 'saved' })).toBe(false)
    expect(usesUnifiedInboxList({ kind: 'tag', tagId })).toBe(false)
    expect(usesUnifiedInboxList({ kind: 'segment', segmentId: segId })).toBe(false)
    expect(usesUnifiedInboxList({ kind: 'custom', viewId })).toBe(false)
  })
})

describe('buildInboxListParams', () => {
  it('maps the mine/unassigned assignee queues to conversation-only kinds', () => {
    expect(buildInboxListParams({ kind: 'view', view: 'mine' }, 'open', 'all', '')).toEqual({
      facet: 'open',
      kinds: ['conversation'],
      assignee: 'me',
      priority: undefined,
      search: undefined,
      companyId: undefined,
      sort: undefined,
    })
    expect(
      buildInboxListParams({ kind: 'view', view: 'unassigned' }, 'waiting', 'high', 'refund')
    ).toEqual({
      facet: 'waiting',
      kinds: ['conversation'],
      assignee: 'unassigned',
      priority: 'high',
      search: 'refund',
      companyId: undefined,
      sort: undefined,
    })
  })

  it('maps "all" to both kinds, with no assignee filter', () => {
    expect(buildInboxListParams({ kind: 'view', view: 'all' }, 'closed', 'all', '')).toEqual({
      facet: 'closed',
      kinds: ['conversation', 'ticket'],
      priority: undefined,
      search: undefined,
      companyId: undefined,
      sort: undefined,
    })
  })

  it('maps a team scope to conversation-only kinds + teamId', () => {
    expect(buildInboxListParams({ kind: 'team', teamId }, 'open', 'all', '', companyId)).toEqual({
      facet: 'open',
      kinds: ['conversation'],
      teamId,
      priority: undefined,
      search: undefined,
      companyId,
      sort: undefined,
    })
  })

  it('maps each Tickets-section scope to ticket-only kinds + ticketType', () => {
    expect(
      buildInboxListParams({ kind: 'view', view: 'tickets_customer' }, 'all', 'all', '')
    ).toMatchObject({ kinds: ['ticket'], ticketType: 'customer' })
    expect(
      buildInboxListParams({ kind: 'view', view: 'tickets_back_office' }, 'all', 'all', '')
    ).toMatchObject({ kinds: ['ticket'], ticketType: 'back_office' })
    expect(
      buildInboxListParams({ kind: 'view', view: 'tickets_tracker' }, 'all', 'all', '')
    ).toMatchObject({ kinds: ['ticket'], ticketType: 'tracker' })
  })

  it('carries a supported sort but clamps an unsupported (conversation-only) sort to undefined', () => {
    expect(
      buildInboxListParams({ kind: 'view', view: 'all' }, 'open', 'all', '', undefined, 'priority')
        .sort
    ).toBe('priority')
    // 'waiting'/'sla' have no ticket-row equivalent and the endpoint's schema
    // rejects them — the client clamps rather than forwarding and 400ing.
    expect(
      buildInboxListParams({ kind: 'view', view: 'all' }, 'open', 'all', '', undefined, 'waiting')
        .sort
    ).toBeUndefined()
    expect(
      buildInboxListParams({ kind: 'view', view: 'all' }, 'open', 'all', '', undefined, 'sla').sort
    ).toBeUndefined()
    // The default 'recent' is omitted just like the legacy buildListParams.
    expect(
      buildInboxListParams({ kind: 'view', view: 'all' }, 'open', 'all', '', undefined, 'recent')
        .sort
    ).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import {
  conversationViewFiltersSchema,
  viewFiltersToListParams,
  viewHasTicketRules,
  viewFiltersToInboxParams,
  isConversationSort,
  defaultConversationSort,
  explicitConversationSort,
  MAX_VIEW_RULES,
  CONVERSATION_SORTS,
  TERMLESS_CONVERSATION_SORTS,
  DEFAULT_CONVERSATION_SORT,
  CONVERSATION_ATTRIBUTE_OPERATORS,
  type ConversationViewFilters,
} from '../views'

describe('conversationViewFiltersSchema', () => {
  it('accepts a valid rule set', () => {
    const filters = {
      rules: [
        { field: 'status', value: 'open' },
        { field: 'priority', value: 'high' },
        { field: 'assignee', value: 'me' },
        { field: 'waiting', value: true },
        { field: 'tag', value: 'conversation_tag_1' },
      ],
    }
    expect(conversationViewFiltersSchema.safeParse(filters).success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const r = conversationViewFiltersSchema.safeParse({
      rules: [{ field: 'status', value: 'archived' }],
    })
    expect(r.success).toBe(false)
  })

  it('rejects a waiting rule whose value is not literally true', () => {
    expect(
      conversationViewFiltersSchema.safeParse({ rules: [{ field: 'waiting', value: false }] })
        .success
    ).toBe(false)
  })

  it(`caps the rule set at ${MAX_VIEW_RULES} rules`, () => {
    const overCap = {
      rules: Array.from({ length: MAX_VIEW_RULES + 1 }, () => ({ field: 'status', value: 'open' })),
    }
    expect(conversationViewFiltersSchema.safeParse(overCap).success).toBe(false)
    const atCap = {
      rules: Array.from({ length: MAX_VIEW_RULES }, () => ({ field: 'status', value: 'open' })),
    }
    expect(conversationViewFiltersSchema.safeParse(atCap).success).toBe(true)
  })

  // Unified inbox §2.8: the four ticket-only rule fields.
  it('accepts the ticket-only rule fields', () => {
    const filters = {
      rules: [
        { field: 'kind', value: 'ticket' },
        { field: 'ticket_type', value: 'customer' },
        { field: 'ticket_status_category', value: 'pending' },
        { field: 'ticket_stage', value: 'in_progress' },
      ],
    }
    expect(conversationViewFiltersSchema.safeParse(filters).success).toBe(true)
  })

  it('rejects an unknown ticket_type value', () => {
    const r = conversationViewFiltersSchema.safeParse({
      rules: [{ field: 'ticket_type', value: 'bogus' }],
    })
    expect(r.success).toBe(false)
  })

  // §C2.7: the dynamic conversation.attr.<key> rule.
  it('accepts an attribute rule for every operator shape', () => {
    for (const operator of CONVERSATION_ATTRIBUTE_OPERATORS) {
      const value =
        operator === 'includes_any' || operator === 'excludes_all'
          ? ['opt_a', 'opt_b']
          : operator === 'is_set' || operator === 'is_empty'
            ? undefined
            : 'opt_a'
      const r = conversationViewFiltersSchema.safeParse({
        rules: [{ field: 'attribute', key: 'issue_type', operator, value }],
      })
      expect(r.success).toBe(true)
    }
  })

  it('accepts a number-valued attribute rule', () => {
    const r = conversationViewFiltersSchema.safeParse({
      rules: [{ field: 'attribute', key: 'seats', operator: 'gte', value: 5 }],
    })
    expect(r.success).toBe(true)
  })

  it('accepts a boolean-valued attribute rule (checkbox)', () => {
    const r = conversationViewFiltersSchema.safeParse({
      rules: [{ field: 'attribute', key: 'is_vip', operator: 'eq', value: true }],
    })
    expect(r.success).toBe(true)
  })

  it('rejects an attribute rule with an empty key', () => {
    const r = conversationViewFiltersSchema.safeParse({
      rules: [{ field: 'attribute', key: '', operator: 'is_set' }],
    })
    expect(r.success).toBe(false)
  })

  it('rejects an attribute rule with an unknown operator', () => {
    const r = conversationViewFiltersSchema.safeParse({
      rules: [{ field: 'attribute', key: 'issue_type', operator: 'startswith', value: 'a' }],
    })
    expect(r.success).toBe(false)
  })
})

describe('viewFiltersToListParams', () => {
  it('translates each rule field to its list-query param', () => {
    const filters: ConversationViewFilters = {
      rules: [
        { field: 'status', value: 'closed' },
        { field: 'priority', value: 'urgent' },
        { field: 'assignee', value: 'unassigned' },
        { field: 'team', value: 'team_1' },
        { field: 'source', value: 'email' },
        { field: 'waiting', value: true },
      ],
    }
    expect(viewFiltersToListParams(filters)).toEqual({
      status: 'closed',
      priority: 'urgent',
      assignee: 'unassigned',
      teamId: 'team_1',
      source: 'email',
      waitingOnly: true,
    })
  })

  it('collects repeated tag rules into an OR-semantics tagIds array', () => {
    const filters: ConversationViewFilters = {
      rules: [
        { field: 'tag', value: 'conversation_tag_a' },
        { field: 'tag', value: 'conversation_tag_b' },
      ],
    }
    expect(viewFiltersToListParams(filters)).toEqual({
      tagIds: ['conversation_tag_a', 'conversation_tag_b'],
    })
  })

  it('returns empty params for an empty rule set', () => {
    expect(viewFiltersToListParams({ rules: [] })).toEqual({})
  })

  it('translates a single attribute rule into an attributeFilters entry', () => {
    const filters: ConversationViewFilters = {
      rules: [{ field: 'attribute', key: 'issue_type', operator: 'eq', value: 'opt_billing' }],
    }
    expect(viewFiltersToListParams(filters)).toEqual({
      attributeFilters: [{ key: 'issue_type', operator: 'eq', value: 'opt_billing' }],
    })
  })

  it('collects repeated attribute rules into an AND-semantics array (unlike tag)', () => {
    const filters: ConversationViewFilters = {
      rules: [
        { field: 'attribute', key: 'issue_type', operator: 'eq', value: 'opt_billing' },
        { field: 'attribute', key: 'urgency', operator: 'is_set' },
      ],
    }
    expect(viewFiltersToListParams(filters)).toEqual({
      attributeFilters: [
        { key: 'issue_type', operator: 'eq', value: 'opt_billing' },
        { key: 'urgency', operator: 'is_set', value: undefined },
      ],
    })
  })

  it('omits attributeFilters entirely when no attribute rule is present', () => {
    expect(
      viewFiltersToListParams({ rules: [{ field: 'status', value: 'open' }] })
    ).not.toHaveProperty('attributeFilters')
  })

  it('normalizes the assignee "me" token to the server-resolved "mine"', () => {
    expect(viewFiltersToListParams({ rules: [{ field: 'assignee', value: 'me' }] })).toEqual({
      assignee: 'mine',
    })
  })

  // The view dialog emits a fixed set of assignee tokens; listConversationsFn
  // only resolves 'mine'/'unassigned'/'all'/a principal id, silently matching
  // everything for anything else. Guard that every token the dialog can save
  // translates into one the server actually honors.
  it('translates every dialog assignee token into a server-resolvable one', () => {
    const DIALOG_ASSIGNEE_TOKENS = ['me', 'unassigned'] as const
    const SERVER_RESOLVABLE = new Set(['all', 'mine', 'unassigned'])
    for (const token of DIALOG_ASSIGNEE_TOKENS) {
      const { assignee } = viewFiltersToListParams({
        rules: [{ field: 'assignee', value: token }],
      })
      expect(assignee && SERVER_RESOLVABLE.has(assignee)).toBe(true)
    }
  })
})

describe('viewHasTicketRules', () => {
  it('is false for a conversation-only rule set', () => {
    expect(
      viewHasTicketRules({
        rules: [
          { field: 'status', value: 'open' },
          { field: 'priority', value: 'high' },
        ],
      })
    ).toBe(false)
  })

  it('is true when any ticket-only field is present', () => {
    expect(viewHasTicketRules({ rules: [{ field: 'kind', value: 'ticket' }] })).toBe(true)
    expect(viewHasTicketRules({ rules: [{ field: 'ticket_type', value: 'customer' }] })).toBe(true)
    expect(
      viewHasTicketRules({ rules: [{ field: 'ticket_status_category', value: 'open' }] })
    ).toBe(true)
    expect(viewHasTicketRules({ rules: [{ field: 'ticket_stage', value: 'received' }] })).toBe(true)
  })
})

describe('viewFiltersToInboxParams', () => {
  it('maps ticket_status_category onto the unified facet vocabulary', () => {
    const result = viewFiltersToInboxParams({
      rules: [{ field: 'ticket_status_category', value: 'pending' }],
    })
    expect(result.kinds).toEqual(['ticket'])
    expect(result.facet).toBe('waiting')
    expect(result.ticketType).toBeUndefined()
    expect(result.ticketStage).toBeUndefined()
  })

  it('defaults facet to "all" when no status-category rule is present', () => {
    const result = viewFiltersToInboxParams({
      rules: [{ field: 'ticket_type', value: 'back_office' }],
    })
    expect(result.facet).toBe('all')
    expect(result.kinds).toEqual(['ticket'])
    expect(result.ticketType).toBe('back_office')
  })

  it('respects a bare kind rule with no other ticket field', () => {
    const result = viewFiltersToInboxParams({ rules: [{ field: 'kind', value: 'conversation' }] })
    expect(result.kinds).toEqual(['conversation'])
    expect(result.facet).toBe('all')
    expect(result.ticketType).toBeUndefined()
    expect(result.ticketStage).toBeUndefined()
  })

  it('carries over priority/assignee/team rules alongside a ticket rule', () => {
    const result = viewFiltersToInboxParams({
      rules: [
        { field: 'kind', value: 'ticket' },
        { field: 'priority', value: 'urgent' },
        { field: 'assignee', value: 'me' },
        { field: 'team', value: 'team_1' },
      ],
    })
    expect(result.priority).toBe('urgent')
    expect(result.assignee).toBe('me')
    expect(result.teamId).toBe('team_1')
  })

  it('maps a conversation status rule onto the facet too', () => {
    const result = viewFiltersToInboxParams({
      rules: [
        { field: 'kind', value: 'conversation' },
        { field: 'status', value: 'snoozed' },
      ],
    })
    expect(result.facet).toBe('waiting')
  })

  it('a later kind rule overrides the ticket-only default', () => {
    const result = viewFiltersToInboxParams({
      rules: [
        { field: 'ticket_type', value: 'customer' },
        { field: 'kind', value: 'ticket' },
      ],
    })
    expect(result.kinds).toEqual(['ticket'])
  })
})

describe('defaultConversationSort', () => {
  it('ranks a searched list by relevance and an unsearched one by activity', () => {
    expect(defaultConversationSort(true)).toBe('relevance')
    expect(defaultConversationSort(false)).toBe(DEFAULT_CONVERSATION_SORT)
  })

  it('never defaults to relevance without a term, which has nothing to score', () => {
    expect(defaultConversationSort(false)).not.toBe('relevance')
  })
})

describe('explicitConversationSort', () => {
  it('drops a sort that only restates the list implicit default', () => {
    expect(explicitConversationSort('recent', false)).toBeUndefined()
    expect(explicitConversationSort('relevance', true)).toBeUndefined()
    expect(explicitConversationSort(undefined, true)).toBeUndefined()
  })

  it('keeps a pinned sort that overrides the searched list relevance default', () => {
    expect(explicitConversationSort('recent', true)).toBe('recent')
    expect(explicitConversationSort('oldest', true)).toBe('oldest')
  })

  it('drops a term-scored sort on a list with no term to score against', () => {
    expect(explicitConversationSort('relevance', false)).toBeUndefined()
  })
})

describe('TERMLESS_CONVERSATION_SORTS', () => {
  it('is every sort except the one that needs a search term to score against', () => {
    expect([...TERMLESS_CONVERSATION_SORTS]).toEqual(
      CONVERSATION_SORTS.filter((s) => s !== 'relevance')
    )
  })
})

describe('isConversationSort', () => {
  it('accepts every canonical sort', () => {
    for (const s of CONVERSATION_SORTS) expect(isConversationSort(s)).toBe(true)
  })
  it('rejects unknown / non-string values', () => {
    expect(isConversationSort('breach')).toBe(false)
    expect(isConversationSort(undefined)).toBe(false)
    expect(isConversationSort(3)).toBe(false)
  })
})

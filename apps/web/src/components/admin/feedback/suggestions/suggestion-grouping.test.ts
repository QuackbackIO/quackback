import { describe, it, expect } from 'vitest'
import { groupSuggestionsBySource } from './suggestion-grouping'
import type { SuggestionListItem } from '../feedback-types'

function makeSuggestion(
  overrides: Partial<SuggestionListItem> & {
    id: string
    suggestionType: SuggestionListItem['suggestionType']
  }
): SuggestionListItem {
  return {
    status: 'pending',
    similarityScore: null,
    suggestedTitle: null,
    suggestedBody: null,
    reasoning: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    rawItem: null,
    targetPost: null,
    sourcePost: null,
    similarPosts: null,
    board: null,
    signal: null,
    ...overrides,
  }
}

const rawItem1 = {
  id: 'raw-1',
  sourceType: 'slack',
  externalUrl: null,
  author: { name: 'Alice' },
  content: { text: 'I want dark mode' },
  sourceCreatedAt: '2026-01-01',
  source: null,
} as SuggestionListItem['rawItem']

const rawItem2 = {
  id: 'raw-2',
  sourceType: 'zendesk',
  externalUrl: null,
  author: { name: 'Bob' },
  content: { text: 'Better search' },
  sourceCreatedAt: '2026-01-02',
  source: null,
} as SuggestionListItem['rawItem']

describe('groupSuggestionsBySource', () => {
  it('groups suggestions with the same rawItem.id', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'create_post', rawItem: rawItem1 }),
      makeSuggestion({ id: 's2', suggestionType: 'vote_on_post', rawItem: rawItem1 }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups).toHaveLength(1)
    expect(groups[0].rawItemId).toBe('raw-1')
    expect(groups[0].suggestions).toHaveLength(2)
  })

  it('sorts vote_on_post before create_post within a group', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'create_post', rawItem: rawItem1 }),
      makeSuggestion({ id: 's2', suggestionType: 'vote_on_post', rawItem: rawItem1 }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups[0].suggestions[0].suggestionType).toBe('vote_on_post')
    expect(groups[0].suggestions[1].suggestionType).toBe('create_post')
  })

  it('creates separate groups for different rawItem.ids', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'create_post', rawItem: rawItem1 }),
      makeSuggestion({ id: 's2', suggestionType: 'create_post', rawItem: rawItem2 }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups).toHaveLength(2)
    expect(groups[0].rawItemId).toBe('raw-1')
    expect(groups[1].rawItemId).toBe('raw-2')
  })

  it('preserves first-appearance group order', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'create_post', rawItem: rawItem2 }),
      makeSuggestion({ id: 's2', suggestionType: 'create_post', rawItem: rawItem1 }),
      makeSuggestion({ id: 's3', suggestionType: 'vote_on_post', rawItem: rawItem2 }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups).toHaveLength(2)
    expect(groups[0].rawItemId).toBe('raw-2')
    expect(groups[1].rawItemId).toBe('raw-1')
  })

  it('treats null rawItem suggestions as singletons', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'duplicate_post', rawItem: null }),
      makeSuggestion({ id: 's2', suggestionType: 'duplicate_post', rawItem: null }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups).toHaveLength(2)
    expect(groups[0].rawItemId).toBe('__solo_s1')
    expect(groups[1].rawItemId).toBe('__solo_s2')
  })

  it('handles single-child groups', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'create_post', rawItem: rawItem1 }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups).toHaveLength(1)
    expect(groups[0].suggestions).toHaveLength(1)
  })

  it('handles empty input', () => {
    expect(groupSuggestionsBySource([])).toEqual([])
  })

  it('mixes grouped and singleton suggestions', () => {
    const suggestions = [
      makeSuggestion({ id: 's1', suggestionType: 'create_post', rawItem: rawItem1 }),
      makeSuggestion({ id: 's2', suggestionType: 'duplicate_post', rawItem: null }),
      makeSuggestion({ id: 's3', suggestionType: 'vote_on_post', rawItem: rawItem1 }),
    ]

    const groups = groupSuggestionsBySource(suggestions)
    expect(groups).toHaveLength(2)
    // First group: raw-1 with 2 suggestions
    expect(groups[0].rawItemId).toBe('raw-1')
    expect(groups[0].suggestions).toHaveLength(2)
    // Second group: singleton
    expect(groups[1].rawItemId).toBe('__solo_s2')
    expect(groups[1].suggestions).toHaveLength(1)
  })
})

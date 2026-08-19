/**
 * `getLiveWorkflowReferencedAttributeKeys` (AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 2): the assistant orchestrator's cost gate for the live attribute
 * re-check. Walks every LIVE workflow's stored graph collecting the key off
 * every `conversation.attr.<key>` condition field — a standalone `condition`
 * gate node, every branch of a `branch` node, and recursively through
 * `all`/`any` groups — and caches the result briefly. Pure db-mocked unit
 * test (mirrors principal-cache.test.ts's idiom); the DB filter itself
 * (status='live', not deleted) is exercised for real in workflow.service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}))

import {
  getLiveWorkflowReferencedAttributeKeys,
  __resetLiveWorkflowReferencedAttributeKeysCache,
} from '../workflow.service'

function mockLiveWorkflows(graphs: unknown[]): void {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(graphs.map((graph) => ({ graph }))),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetLiveWorkflowReferencedAttributeKeysCache()
})

describe('getLiveWorkflowReferencedAttributeKeys', () => {
  it('is empty when there are no live workflows', async () => {
    mockLiveWorkflows([])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect(keys.size).toBe(0)
  })

  it('collects a key referenced by a standalone condition gate node', async () => {
    mockLiveWorkflows([
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.issue_type', op: 'eq', value: 'opt_1' },
          },
        ],
        edges: [],
      },
    ])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect([...keys]).toEqual(['issue_type'])
  })

  it('collects keys referenced in every branch of a branch node', async () => {
    mockLiveWorkflows([
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'b',
            type: 'branch',
            branches: [
              {
                key: 'billing',
                condition: {
                  field: 'conversation.attr.issue_type',
                  op: 'eq',
                  value: 'opt_billing',
                },
              },
              {
                key: 'bug',
                condition: { field: 'conversation.attr.issue_type', op: 'eq', value: 'opt_bug' },
              },
            ],
          },
        ],
        edges: [],
      },
    ])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect([...keys]).toEqual(['issue_type'])
  })

  it('recurses through nested all/any condition groups', async () => {
    mockLiveWorkflows([
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: {
              all: [
                { field: 'conversation.priority', op: 'eq', value: 'high' },
                {
                  any: [{ field: 'conversation.attr.sentiment', op: 'eq', value: 'opt_negative' }],
                },
              ],
            },
          },
        ],
        edges: [],
      },
    ])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect([...keys]).toEqual(['sentiment'])
  })

  it('ignores condition fields that are not attribute predicates', async () => {
    mockLiveWorkflows([
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.priority', op: 'eq', value: 'high' },
          },
        ],
        edges: [],
      },
    ])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect(keys.size).toBe(0)
  })

  it('is defensive against a malformed or empty stored graph', async () => {
    mockLiveWorkflows([null, { nodes: 'not-an-array' }, {}, { nodes: [] }])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect(keys.size).toBe(0)
  })

  it('unions keys referenced across multiple live workflows', async () => {
    mockLiveWorkflows([
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.issue_type', op: 'is_set' },
          },
        ],
        edges: [],
      },
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.sentiment', op: 'is_set' },
          },
        ],
        edges: [],
      },
    ])
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect(new Set(keys)).toEqual(new Set(['issue_type', 'sentiment']))
  })

  it('caches the result and does not re-query within the TTL', async () => {
    mockLiveWorkflows([
      {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.issue_type', op: 'is_set' },
          },
        ],
        edges: [],
      },
    ])
    await getLiveWorkflowReferencedAttributeKeys()
    await getLiveWorkflowReferencedAttributeKeys()
    expect(mockSelect).toHaveBeenCalledTimes(1)
  })

  it('re-queries after the cache is reset', async () => {
    mockLiveWorkflows([])
    await getLiveWorkflowReferencedAttributeKeys()
    __resetLiveWorkflowReferencedAttributeKeysCache()
    await getLiveWorkflowReferencedAttributeKeys()
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })
})

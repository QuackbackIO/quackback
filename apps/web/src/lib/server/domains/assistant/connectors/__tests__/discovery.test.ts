import { describe, expect, it } from 'vitest'
import { applyCatalogDiff, applyConnectorCatalogDiff } from '../discovery'
import { DEFAULT_CONNECTOR_TOOL_POLICIES } from '@/lib/shared/assistant/connectors'

describe('applyCatalogDiff', () => {
  it('adds new tools with firstSeenAt and keeps existing timestamps', () => {
    const previous = [
      {
        name: 'get_invoice',
        annotations: { readOnlyHint: true },
        firstSeenAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const diff = applyCatalogDiff(previous, [
      { name: 'get_invoice', annotations: { readOnlyHint: true } },
      { name: 'issue_refund', annotations: { destructiveHint: true } },
    ])
    expect(diff.added).toEqual(['issue_refund'])
    expect(diff.removed).toEqual([])
    expect(diff.tools.find((tool) => tool.name === 'get_invoice')?.firstSeenAt).toBe(
      '2026-01-01T00:00:00.000Z'
    )
    expect(diff.tools.find((tool) => tool.name === 'issue_refund')?.firstSeenAt).toBeTruthy()
  })

  it('prunes vanished tools from catalog and policy overrides', () => {
    const previous = [
      {
        name: 'gone',
        annotations: {},
        firstSeenAt: '2026-01-01T00:00:00.000Z',
      },
      {
        name: 'stay',
        annotations: { readOnlyHint: true },
        firstSeenAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const policies = {
      ...DEFAULT_CONNECTOR_TOOL_POLICIES,
      tools: { gone: 'never' as const, stay: 'always' as const },
    }
    const diff = applyCatalogDiff(
      previous,
      [{ name: 'stay', annotations: { readOnlyHint: true } }],
      policies
    )
    expect(diff.removed).toEqual(['gone'])
    expect(diff.toolPolicies.tools).toEqual({ stay: 'always' })
    expect(diff.tools.map((tool) => tool.name)).toEqual(['stay'])
  })
})

describe('applyConnectorCatalogDiff', () => {
  const previousTool = {
    name: 'get_invoice',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    firstSeenAt: '2026-01-01T00:00:00.000Z',
  }
  const state = {
    tools: [previousTool],
    toolPolicies: {
      groupDefaults: { read: 'always' as const, write: 'approval' as const },
      tools: { get_invoice: 'always' as const },
    },
    profilePolicies: null,
    toolReviews: null,
    catalogRevision: 3,
    assignments: { agent: true, copilot: false },
  }

  it('projects the shared map into the assigned use only', () => {
    const diff = applyConnectorCatalogDiff(state, [
      {
        name: 'get_invoice',
        annotations: { readOnlyHint: true },
        inputSchema: previousTool.inputSchema,
      },
    ])
    expect(diff.profilePolicies.agent?.tools).toEqual({ get_invoice: 'always' })
    expect(diff.profilePolicies.copilot).toBeUndefined()
  })

  it('leaves a newly discovered tool without a reviewed contract', () => {
    const diff = applyConnectorCatalogDiff(state, [
      {
        name: 'get_invoice',
        annotations: { readOnlyHint: true },
        inputSchema: previousTool.inputSchema,
      },
      { name: 'issue_refund', annotations: {} },
    ])
    expect(diff.added).toEqual(['issue_refund'])
    expect(diff.toolReviews.issue_refund).toBeUndefined()
    expect(diff.toolReviews.get_invoice).toBeDefined()
    expect(diff.catalogRevision).toBe(4)
  })

  it('reports a changed contract and moves the revision', () => {
    const diff = applyConnectorCatalogDiff(state, [
      {
        name: 'get_invoice',
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object', properties: { id: { type: 'number' } } },
      },
    ])
    expect(diff.changed).toEqual(['get_invoice'])
    expect(diff.catalogRevision).toBe(4)
  })

  it('leaves the revision alone when nothing moved', () => {
    const diff = applyConnectorCatalogDiff(state, [
      {
        name: 'get_invoice',
        annotations: { readOnlyHint: true },
        inputSchema: previousTool.inputSchema,
      },
    ])
    expect(diff.changed).toEqual([])
    expect(diff.catalogRevision).toBe(3)
  })

  it('prunes a vanished tool from every use override and from the reviews', () => {
    const diff = applyConnectorCatalogDiff(
      {
        ...state,
        tools: [
          previousTool,
          { name: 'gone', annotations: {}, firstSeenAt: '2026-01-01T00:00:00.000Z' },
        ],
        profilePolicies: {
          agent: {
            groupDefaults: { read: 'always', write: 'approval' },
            tools: { gone: 'never', get_invoice: 'always' },
          },
        },
        toolReviews: null,
      },
      [
        {
          name: 'get_invoice',
          annotations: { readOnlyHint: true },
          inputSchema: previousTool.inputSchema,
        },
      ]
    )
    expect(diff.removed).toEqual(['gone'])
    expect(diff.profilePolicies.agent?.tools).toEqual({ get_invoice: 'always' })
    expect(diff.toolReviews.gone).toBeUndefined()
  })
})

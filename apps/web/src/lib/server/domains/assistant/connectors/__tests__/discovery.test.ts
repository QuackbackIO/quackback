import { describe, expect, it } from 'vitest'
import { applyCatalogDiff } from '../discovery'
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

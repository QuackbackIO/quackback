/**
 * The reviewed catalog.
 *
 * Discovery used to let a new tool inherit its group default, so a remote
 * server could add a read tool and have Quinn call it on the next turn. These
 * cases pin the replacement: a contract is callable only while it still
 * matches the one somebody reviewed.
 */
import { describe, expect, it } from 'vitest'
import type { CachedConnectorTool } from '@/lib/server/db'
import {
  grandfatherToolReviews,
  pruneToolReviews,
  reviewStateForTool,
  reviewToolContracts,
  toolContractFingerprint,
} from '../catalog-review'

function tool(overrides: Partial<CachedConnectorTool> = {}): CachedConnectorTool {
  return {
    name: 'issue_refund',
    annotations: {},
    inputSchema: { type: 'object', properties: { amount: { type: 'integer' } } },
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('toolContractFingerprint', () => {
  it('ignores property order in the declared schema', () => {
    const a = toolContractFingerprint(
      tool({ inputSchema: { type: 'object', properties: { a: { type: 'string' } } } })
    )
    const b = toolContractFingerprint(
      tool({ inputSchema: { properties: { a: { type: 'string' } }, type: 'object' } })
    )
    expect(a.schemaHash).toBe(b.schemaHash)
  })

  it('separates a changed schema, a changed read hint and a changed destructive hint', () => {
    const base = toolContractFingerprint(tool())
    expect(toolContractFingerprint(tool({ inputSchema: { type: 'object' } })).schemaHash).not.toBe(
      base.schemaHash
    )
    expect(
      toolContractFingerprint(tool({ annotations: { readOnlyHint: true } })).readOnlyHint
    ).toBe(true)
    expect(
      toolContractFingerprint(tool({ annotations: { destructiveHint: true } })).destructiveHint
    ).toBe(true)
  })
})

describe('reviewStateForTool', () => {
  it('reports an unknown tool as new', () => {
    const state = reviewStateForTool(tool(), {})
    expect(state.state).toBe('new')
    expect(state.reviewed).toBe(false)
  })

  it('reports a matching contract as reviewed', () => {
    const reviews = grandfatherToolReviews([tool()], 1)
    const state = reviewStateForTool(tool(), reviews)
    expect(state.state).toBe('reviewed')
    expect(state.reviewed).toBe(true)
    expect(state.changes).toEqual([])
  })

  it('reports a changed input schema and says so', () => {
    const reviews = grandfatherToolReviews([tool()], 1)
    const state = reviewStateForTool(
      tool({ inputSchema: { type: 'object', properties: { amount: { type: 'string' } } } }),
      reviews
    )
    expect(state.state).toBe('changed')
    expect(state.reviewed).toBe(false)
    expect(state.changes.join(' ')).toContain('input schema')
  })

  it('reports a flipped annotation as a change, because it decides the group', () => {
    const reviews = grandfatherToolReviews([tool({ annotations: { readOnlyHint: true } })], 1)
    const state = reviewStateForTool(tool({ annotations: {} }), reviews)
    expect(state.state).toBe('changed')
    expect(state.changes.join(' ')).toContain('read-only')
  })

  it('reports a newly destructive tool as changed', () => {
    const reviews = grandfatherToolReviews([tool()], 1)
    const state = reviewStateForTool(tool({ annotations: { destructiveHint: true } }), reviews)
    expect(state.state).toBe('changed')
    expect(state.changes.join(' ')).toContain('destructive')
  })
})

describe('grandfatherToolReviews', () => {
  it('records the contract the tools already had, marked as carried over', () => {
    const reviews = grandfatherToolReviews([tool(), tool({ name: 'get_invoice' })], 4)
    expect(Object.keys(reviews).sort()).toEqual(['get_invoice', 'issue_refund'])
    expect(reviews.issue_refund!.origin).toBe('grandfathered')
    expect(reviews.issue_refund!.catalogRevision).toBe(4)
    expect(reviews.issue_refund!.reviewedByPrincipalId).toBeNull()
  })
})

describe('reviewToolContracts', () => {
  it('reviews only the named tools and records who did it', () => {
    const live = [tool(), tool({ name: 'get_invoice' })]
    const reviews = reviewToolContracts({
      tools: live,
      reviews: {},
      toolNames: ['issue_refund'],
      catalogRevision: 7,
      principalId: 'principal_abc',
    })
    expect(reviewStateForTool(live[0]!, reviews).reviewed).toBe(true)
    expect(reviewStateForTool(live[1]!, reviews).reviewed).toBe(false)
    expect(reviews.issue_refund!.origin).toBe('reviewed')
    expect(reviews.issue_refund!.reviewedByPrincipalId).toBe('principal_abc')
    expect(reviews.issue_refund!.catalogRevision).toBe(7)
  })

  it('ignores a name the live catalog does not have', () => {
    const reviews = reviewToolContracts({
      tools: [tool()],
      reviews: {},
      toolNames: ['not_a_tool'],
      catalogRevision: 1,
      principalId: null,
    })
    expect(reviews.not_a_tool).toBeUndefined()
  })

  it('re-reviewing a changed contract makes it current again', () => {
    const original = tool()
    const reviews = grandfatherToolReviews([original], 1)
    const changed = tool({ inputSchema: { type: 'object', properties: { amount: {} } } })
    expect(reviewStateForTool(changed, reviews).reviewed).toBe(false)
    const next = reviewToolContracts({
      tools: [changed],
      reviews,
      toolNames: [changed.name],
      catalogRevision: 2,
      principalId: null,
    })
    expect(reviewStateForTool(changed, next).reviewed).toBe(true)
    expect(reviewStateForTool(original, next).reviewed).toBe(false)
  })
})

describe('pruneToolReviews', () => {
  it('drops reviews for tools the server no longer publishes', () => {
    const reviews = grandfatherToolReviews([tool(), tool({ name: 'gone' })], 1)
    const pruned = pruneToolReviews(reviews, new Set(['issue_refund']))
    expect(Object.keys(pruned)).toEqual(['issue_refund'])
  })
})

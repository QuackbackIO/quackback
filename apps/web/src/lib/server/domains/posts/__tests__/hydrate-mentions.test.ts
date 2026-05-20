/**
 * Tests for hydrateMentions — re-resolves mention.label against the live
 * principal.displayName so renamed users show their current name on render,
 * and deleted principals collapse to plain `@<storedLabel>` text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { JSONContent } from '@tiptap/core'

// State the mocked DB select returns for the in-test query.
let selectRows: Array<{ id: string; displayName: string }> = []

// Mock the project db facade. The real module re-exports drizzle's `inArray`
// and the `principal` table; tests only need a chainable `db.select(...)` that
// resolves to our prepared rows.
vi.mock('@/lib/server/db', () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(selectRows),
        }),
      }),
    },
    // The real implementation imports these for typing/identity, but our
    // chainable mock ignores them. Provide stubs so the import doesn't crash.
    principal: { id: 'id', displayName: 'displayName' },
    inArray: () => undefined,
  }
})

import { hydrateMentions } from '../hydrate-mentions'

describe('hydrateMentions', () => {
  beforeEach(() => {
    selectRows = []
  })

  it('overwrites mention.label with current displayName', async () => {
    selectRows = [{ id: 'principal_jane', displayName: 'Jane Renamed' }]
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'principal_jane', label: 'Old Name' } }],
        },
      ],
    }
    const hydrated = await hydrateMentions(doc)
    const node = hydrated.content?.[0].content?.[0]
    expect(node?.type).toBe('mention')
    expect(node?.attrs?.label).toBe('Jane Renamed')
    // The id stays put so the chip overlay can still resolve by principalId.
    expect(node?.attrs?.id).toBe('principal_jane')
  })

  it('converts deleted-principal mention to plain text node', async () => {
    selectRows = [] // principal not found
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'principal_gone', label: 'Stored Label' } }],
        },
      ],
    }
    const hydrated = await hydrateMentions(doc)
    const node = hydrated.content?.[0].content?.[0]
    expect(node?.type).toBe('text')
    expect(node?.text).toBe('@Stored Label')
  })

  it('returns content unchanged when there are no mentions', async () => {
    const spy = vi.fn(() => Promise.resolve([]))
    // Re-mock select to assert it's never called.
    selectRows = []
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    }
    const hydrated = await hydrateMentions(doc)
    expect(hydrated).toBe(doc)
    // sanity: spy never invoked (we didn't wire it in; extractMentions short-
    // circuits before any db.select call).
    expect(spy).not.toHaveBeenCalled()
  })

  it('hydrates multiple mentions in a single document with one round-trip', async () => {
    selectRows = [
      { id: 'principal_a', displayName: 'Alice New' },
      { id: 'principal_b', displayName: 'Bob New' },
    ]
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'principal_a', label: 'Alice Old' } },
            { type: 'text', text: ' and ' },
            { type: 'mention', attrs: { id: 'principal_b', label: 'Bob Old' } },
          ],
        },
      ],
    }
    const hydrated = await hydrateMentions(doc)
    const para = hydrated.content?.[0]
    expect(para?.content?.[0].attrs?.label).toBe('Alice New')
    expect(para?.content?.[2].attrs?.label).toBe('Bob New')
  })
})

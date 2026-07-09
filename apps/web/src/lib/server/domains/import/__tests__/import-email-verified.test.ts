/**
 * The email_verified CSV column: truthy-form parsing (true/1/yes,
 * case-insensitive, default false) and the plumb from resolveRows into
 * ImportUserResolver.resolve — asserting a verified email is a trust
 * decision, so only recognized spellings may flip it on.
 */
import { describe, it, expect, vi } from 'vitest'
import type { PrincipalId, PostStatusId } from '@quackback/ids'
import { parseCsvBoolean, csvRowSchema, resolveRows, type RowContext } from '../import-row-resolver'
import type { ImportUserResolver } from '../user-resolver'

describe('parseCsvBoolean', () => {
  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', ' Yes '])('parses %j as true', (value) => {
    expect(parseCsvBoolean(value)).toBe(true)
  })

  it.each(['', 'false', 'no', '0', 'verified', 'y', 't', 'oui', undefined])(
    'parses %j as false',
    (value) => {
      expect(parseCsvBoolean(value)).toBe(false)
    }
  )
})

describe('csvRowSchema email_verified', () => {
  const baseRow = { title: 'A title', content: 'Some content' }

  it('defaults to false when the column is absent', () => {
    const parsed = csvRowSchema.parse(baseRow)
    expect(parsed.email_verified).toBe(false)
  })

  it('parses recognized truthy forms', () => {
    for (const value of ['true', 'Yes', '1']) {
      const parsed = csvRowSchema.parse({ ...baseRow, email_verified: value })
      expect(parsed.email_verified).toBe(true)
    }
  })

  it('treats unrecognized values as false rather than erroring', () => {
    const parsed = csvRowSchema.parse({ ...baseRow, email_verified: 'maybe' })
    expect(parsed.email_verified).toBe(false)
  })
})

describe('resolveRows email_verified plumb', () => {
  const FALLBACK = 'principal_fallback' as PrincipalId

  function stubCtx(): RowContext {
    return {
      defaultStatusId: 'post_status_default' as PostStatusId,
      statusMap: new Map(),
      tagMap: new Map(),
      boardMap: new Map(),
    }
  }

  function captureResolver() {
    const resolve = vi.fn().mockResolvedValue('principal_resolved' as PrincipalId)
    const resolver = {
      resolve,
      get pendingCount() {
        return 0
      },
    } as unknown as ImportUserResolver
    return { resolver, resolve }
  }

  it('passes the parsed flag through to the user resolver', async () => {
    const { resolver, resolve } = captureResolver()
    const rows = [
      { title: 'T1', content: 'C1', author_email: 'a@example.com', email_verified: 'true' },
      { title: 'T2', content: 'C2', author_email: 'b@example.com', email_verified: 'no' },
      { title: 'T3', content: 'C3', author_email: 'c@example.com', email_verified: '' },
    ]

    const { validRows, errors } = await resolveRows(
      rows,
      'board_1' as never,
      0,
      resolver,
      FALLBACK,
      stubCtx(),
      new Set()
    )

    expect(errors).toEqual([])
    expect(validRows).toHaveLength(3)
    expect(resolve).toHaveBeenNthCalledWith(1, 'a@example.com', null, FALLBACK, true)
    expect(resolve).toHaveBeenNthCalledWith(2, 'b@example.com', null, FALLBACK, false)
    expect(resolve).toHaveBeenNthCalledWith(3, 'c@example.com', null, FALLBACK, false)
  })
})

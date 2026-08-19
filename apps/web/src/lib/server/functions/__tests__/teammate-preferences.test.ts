/**
 * getMyLanguagePreferenceFn / setMyLanguagePreferenceFn are self-scoped:
 * both require only a valid authenticated principal (no permission gate --
 * "your own preference" isn't an RBAC permission), and both read/write the
 * caller's own `user` row. These tests pin the validation rules and the
 * self-scoping (the update targets the auth-context user id, never a value
 * from the request payload).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setMyLanguagePreferenceSchema } from '../teammate-preferences'

// Mock createServerFn to just return the handler directly (mirrors the
// project's existing pattern in user-stats.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
}))

const mockRequireAuth = vi.fn()
vi.mock('../auth-helpers', () => ({
  requireAuth: () => mockRequireAuth(),
}))

const mockFindFirst = vi.fn()
const mockSet = vi.fn()
const mockReturning = vi.fn()
const mockEq = vi.fn()

// Spread the real db module so tables/operators stay current; override only
// the query surface this suite drives. `eq` is wrapped (not replaced) so its
// real, comparable condition object still reaches `.where()`, while the test
// can assert on the raw arguments it was called with.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...original,
    eq: (...args: [unknown, unknown]) => {
      mockEq(...args)
      return original.eq(...(args as Parameters<typeof original.eq>))
    },
    db: {
      query: {
        user: {
          findFirst: (...args: unknown[]) => mockFindFirst(...args),
        },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          mockSet(values)
          return {
            where: (...whereArgs: unknown[]) => ({
              returning: (...args: unknown[]) => mockReturning(...whereArgs, ...args),
            }),
          }
        },
      }),
    },
  }
})

import { getMyLanguagePreferenceFn, setMyLanguagePreferenceFn } from '../teammate-preferences'
import { user } from '@/lib/server/db'

const AUTH_USER_ID = 'user_caller'

describe('setMyLanguagePreferenceSchema', () => {
  it('accepts a bare two-letter tag', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: 'en' })).not.toThrow()
  })

  it('accepts a region-qualified tag', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: 'pt-BR' })).not.toThrow()
  })

  it('accepts a script + region tag', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: 'zh-Hans-CN' })).not.toThrow()
  })

  it('accepts null (clears the preference)', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: null })).not.toThrow()
  })

  it('rejects an empty string', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: '' })).toThrow()
  })

  it('rejects a garbage value', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: 'not a tag!' })).toThrow()
  })

  it('rejects a value with a path-traversal-style separator', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({ language: '../../etc' })).toThrow()
  })

  it('rejects a missing language key', () => {
    expect(() => setMyLanguagePreferenceSchema.parse({})).toThrow()
  })
})

describe('getMyLanguagePreferenceFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAuth.mockResolvedValue({
      user: { id: AUTH_USER_ID },
      principal: { id: 'principal_caller' },
    })
  })

  it("returns the caller's stored language", async () => {
    mockFindFirst.mockResolvedValue({ preferredLanguage: 'fr' })

    const result = await getMyLanguagePreferenceFn()

    expect(result).toEqual({ language: 'fr' })
  })

  it('returns null when no preference is set', async () => {
    mockFindFirst.mockResolvedValue({ preferredLanguage: null })

    const result = await getMyLanguagePreferenceFn()

    expect(result).toEqual({ language: null })
  })

  it('returns null when the row lookup comes back empty', async () => {
    mockFindFirst.mockResolvedValue(undefined)

    const result = await getMyLanguagePreferenceFn()

    expect(result).toEqual({ language: null })
  })

  it('throws when the caller is not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'))

    await expect(getMyLanguagePreferenceFn()).rejects.toThrow('Authentication required')
  })
})

describe('setMyLanguagePreferenceFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAuth.mockResolvedValue({
      user: { id: AUTH_USER_ID },
      principal: { id: 'principal_caller' },
    })
  })

  it('sets a valid BCP-47 language for the current user', async () => {
    mockReturning.mockResolvedValue([{ preferredLanguage: 'pt-BR' }])

    const result = await setMyLanguagePreferenceFn({ data: { language: 'pt-BR' } })

    expect(result).toEqual({ language: 'pt-BR' })
    expect(mockSet).toHaveBeenCalledWith({ preferredLanguage: 'pt-BR' })
  })

  it('clears the preference when language is null', async () => {
    mockReturning.mockResolvedValue([{ preferredLanguage: null }])

    const result = await setMyLanguagePreferenceFn({ data: { language: null } })

    expect(result).toEqual({ language: null })
    expect(mockSet).toHaveBeenCalledWith({ preferredLanguage: null })
  })

  it("scopes the write to the auth context's user id, never a payload field", async () => {
    mockReturning.mockResolvedValue([{ preferredLanguage: 'de' }])

    // The input schema has no userId field at all -- there is no path for a
    // caller to name a different row. Assert the where-clause is literally
    // built from `eq(user.id, auth.user.id)` using the id requireAuth()
    // returned, not from anything in the request payload.
    await setMyLanguagePreferenceFn({ data: { language: 'de' } })

    expect(mockRequireAuth).toHaveBeenCalledTimes(1)
    expect(mockEq).toHaveBeenCalledWith(user.id, AUTH_USER_ID)
  })

  it('throws when the caller is not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'))

    await expect(setMyLanguagePreferenceFn({ data: { language: 'en' } })).rejects.toThrow(
      'Authentication required'
    )
  })
})

import { describe, expect, it } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { ConflictError, InternalError, ValidationError } from '@/lib/shared/errors'
import { isTechnicalFailure, newErrorReference } from '../technical-failure'

describe('isTechnicalFailure', () => {
  it('hides a failed query, which carries its SQL and values', () => {
    const failed = new DrizzleQueryError(
      'select "email" from "principals" where "email" = $1',
      ['dana@acme.com'],
      new Error('relation "principals" does not exist')
    )
    expect(failed.message).toContain('dana@acme.com')
    expect(isTechnicalFailure(failed)).toBe(true)
  })

  it('hides a failed query a service wrapped in its own words', () => {
    expect(
      isTechnicalFailure(new Error('Failed to fetch board: Failed query: select 1\nparams: '))
    ).toBe(true)
    expect(
      isTechnicalFailure(new InternalError('DATABASE_ERROR', 'Failed to fetch board: timeout'))
    ).toBe(true)
  })

  it('hides network faults, which name internal addresses', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.4.17:5432'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
    })
    expect(isTechnicalFailure(refused)).toBe(true)
    expect(
      isTechnicalFailure(Object.assign(new Error('fetch failed'), { code: 'UND_ERR_SOCKET' }))
    ).toBe(true)
  })

  it('hides bugs', () => {
    let bug: unknown
    try {
      const missing = undefined as unknown as { settings: { name: string } }
      void missing.settings.name
    } catch (error) {
      bug = error
    }
    expect(bug).toBeInstanceOf(TypeError)
    expect(isTechnicalFailure(bug)).toBe(true)
    expect(isTechnicalFailure('a thrown string')).toBe(true)
  })

  it("hides a provider's reply", () => {
    const reply = Object.assign(new Error('401 Incorrect API key provided: sk-abc'), {
      status: 401,
      headers: new Headers(),
    })
    expect(isTechnicalFailure(reply)).toBe(true)
  })

  it('leaves a message written for a person alone', () => {
    expect(isTechnicalFailure(new Error('Pick a board first'))).toBe(false)
    expect(isTechnicalFailure(new ValidationError('BAD', 'Name is required'))).toBe(false)
    expect(isTechnicalFailure(new ConflictError('DUPLICATE_SLUG', 'That slug is taken'))).toBe(
      false
    )
    // A code of the writer's own that happens to start with E.
    expect(
      isTechnicalFailure(Object.assign(new Error('That email is taken'), { code: 'EMAIL_TAKEN' }))
    ).toBe(false)
  })
})

describe('newErrorReference', () => {
  it('follows the request id, so the code and the log line agree', () => {
    expect(newErrorReference('d264c488-5cab-4bdc-a1f0-4bc2abbc11d2')).toBe('D264-C488')
  })

  it('makes one up when the request id is missing or too short to use', () => {
    expect(newErrorReference(undefined)).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(newErrorReference('abc')).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(newErrorReference(undefined)).not.toBe(newErrorReference(undefined))
  })
})

import { describe, expect, it } from 'vitest'
import { parseSessionModeDsn, SessionModeDsnError } from '../session-dsn'

describe('parseSessionModeDsn', () => {
  it('accepts a complete session-mode URL', () => {
    expect(
      parseSessionModeDsn('postgresql://qb_x:s3cret@postgres.railway.internal:5432/qb_x')
    ).toMatchObject({
      host: 'postgres.railway.internal',
      port: 5432,
      database: 'qb_x',
      username: 'qb_x',
      password: 's3cret',
    })
  })

  it('refuses a URL with no password so PG* cannot fill it', () => {
    expect(() =>
      parseSessionModeDsn('postgresql://qb_x@postgres.railway.internal:5432/qb_x')
    ).toThrow(SessionModeDsnError)
    try {
      parseSessionModeDsn('postgresql://qb_x@postgres.railway.internal:5432/qb_x')
    } catch (err) {
      expect(err).toBeInstanceOf(SessionModeDsnError)
      expect((err as SessionModeDsnError).reason).toBe('credentials')
      expect((err as Error).message).not.toContain('postgresql://')
    }
  })

  it('refuses a unix-socket host', () => {
    expect(() => parseSessionModeDsn('postgresql://qb_x:s3cret@/var/run/postgresql/qb_x')).toThrow(
      SessionModeDsnError
    )
  })

  it('refuses a pooler hostname', () => {
    try {
      parseSessionModeDsn('postgresql://qb_x:s3cret@pg-xxx-pooler.railway.internal:5432/qb_x')
    } catch (err) {
      expect((err as SessionModeDsnError).reason).toBe('pooled')
    }
  })

  it('refuses a non-postgres scheme', () => {
    try {
      parseSessionModeDsn('https://qb_x:s3cret@evil.example/qb_x')
    } catch (err) {
      expect((err as SessionModeDsnError).reason).toBe('scheme')
    }
  })
})

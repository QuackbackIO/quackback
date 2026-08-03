/**
 * Differential-coverage tests for audit.context — every branch of
 * buildAuditContext: null auth, the AuthContext (principal) shape, and the
 * ApiAuthContext (principalId) shape, each with present and defaulted fields.
 */
import { describe, it, expect } from 'vitest'
import { buildAuditContext } from '../audit.context'

describe('buildAuditContext', () => {
  it('returns system attribution for null/undefined auth', () => {
    expect(buildAuditContext(null)).toEqual({
      principalId: null,
      ipAddress: null,
      userAgent: null,
      source: 'system',
    })
    expect(buildAuditContext(undefined)).toMatchObject({ source: 'system' })
  })

  it('maps an AuthContext with all fields present', () => {
    expect(
      buildAuditContext({
        principal: { id: 'p1' as never },
        ipAddress: '1.2.3.4',
        userAgent: 'agent',
        source: 'api',
      } as never)
    ).toEqual({ principalId: 'p1', ipAddress: '1.2.3.4', userAgent: 'agent', source: 'api' })
  })

  it('defaults an AuthContext with missing fields (web source)', () => {
    expect(buildAuditContext({ principal: { id: 'p1' as never } } as never)).toEqual({
      principalId: 'p1',
      ipAddress: null,
      userAgent: null,
      source: 'web',
    })
  })

  it('maps an ApiAuthContext with all fields present', () => {
    expect(
      buildAuditContext({
        principalId: 'p2' as never,
        ipAddress: '5.6.7.8',
        userAgent: 'ua',
        source: 'web' as never,
      })
    ).toEqual({ principalId: 'p2', ipAddress: '5.6.7.8', userAgent: 'ua', source: 'web' })
  })

  it('defaults an ApiAuthContext with missing fields (api source)', () => {
    expect(buildAuditContext({ principalId: 'p2' as never } as never)).toEqual({
      principalId: 'p2',
      ipAddress: null,
      userAgent: null,
      source: 'api',
    })
  })
})

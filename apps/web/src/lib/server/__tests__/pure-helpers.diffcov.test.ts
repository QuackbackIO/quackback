/**
 * Differential-coverage tests for small pure helpers that had residual gaps:
 * organizations/normalize, help-center.visibility, widget/cors error mapping,
 * and storage/s3 attachment-type allowlist.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeEmail,
  normalizeDomain,
  parseDomainFromEmail,
} from '../domains/organizations/normalize'
import { canActorViewCategory } from '../domains/help-center/help-center.visibility'
import {
  widgetCorsHeaders,
  widgetJsonError,
  widgetJsonOk,
  mapDomainErrorToResponse,
} from '../widget/cors'
import { isAllowedAttachmentType } from '../storage/s3'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'

const EMAIL = ['jane', 'doe'].join('.') + '@' + 'acme.com'
describe('normalize', () => {
  it('normalizeEmail trims, lowercases, strips mailto/brackets, validates', () => {
    expect(normalizeEmail(`  <${EMAIL.toUpperCase()}> `)).toBe(EMAIL)
    expect(normalizeEmail(`mailto:${EMAIL}`)).toBe(EMAIL)
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail('not-an-email')).toBeNull()
  })
  it('normalizeDomain strips protocol/path/port/dots and validates', () => {
    expect(normalizeDomain('https://Acme.com/path?x=1#h')).toBe('acme.com')
    expect(normalizeDomain('.acme.com.')).toBe('acme.com')
    expect(normalizeDomain('localhost')).toBeNull() // no dot
    expect(normalizeDomain('bad_domain!.com')).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain('  ')).toBeNull()
  })
  it('parseDomainFromEmail extracts + normalizes', () => {
    expect(parseDomainFromEmail(EMAIL)).toBe('acme.com')
    expect(parseDomainFromEmail('bad')).toBeNull()
  })
})

describe('help-center visibility', () => {
  const cat = (over: Record<string, unknown> = {}) =>
    ({
      isPublic: true,
      visibility: 'public',
      allowedPrincipalIds: [],
      allowedSegmentIds: [],
      ...over,
    }) as never
  it('covers private, public, targeted (principal + segment), and no-actor', () => {
    expect(canActorViewCategory(cat({ isPublic: false }), null)).toBe(false)
    expect(canActorViewCategory(cat(), null)).toBe(true)
    expect(canActorViewCategory(cat({ visibility: 'targeted' }), null)).toBe(false)
    expect(
      canActorViewCategory(cat({ visibility: 'targeted', allowedPrincipalIds: ['p1'] }), {
        principalId: 'p1',
        segmentIds: new Set(),
      } as never)
    ).toBe(true)
    expect(
      canActorViewCategory(cat({ visibility: 'targeted', allowedSegmentIds: ['s1'] }), {
        principalId: 'p2',
        segmentIds: new Set(['s1']),
      } as never)
    ).toBe(true)
    expect(
      canActorViewCategory(cat({ visibility: 'targeted', allowedSegmentIds: [] }), {
        principalId: 'p2',
        segmentIds: new Set(['s1']),
      } as never)
    ).toBe(false)
  })
})

describe('widget/cors', () => {
  it('builds CORS headers + ok/error responses', () => {
    expect(widgetCorsHeaders().get('Access-Control-Allow-Origin')).toBe('*')
    expect(widgetJsonError('X', 'msg', 400).status).toBe(400)
    expect(widgetJsonOk({ a: 1 }).status).toBe(200)
  })
  it('maps each domain error to its status, null otherwise', () => {
    expect(mapDomainErrorToResponse(new NotFoundError('NF', 'x'))?.status).toBe(404)
    expect(mapDomainErrorToResponse(new ConflictError('C', 'x'))?.status).toBe(409)
    expect(mapDomainErrorToResponse(new ValidationError('V', 'x'))?.status).toBe(400)
    expect(mapDomainErrorToResponse(new ForbiddenError('F', 'x'))?.status).toBe(403)
    expect(mapDomainErrorToResponse(new Error('plain'))).toBeNull()
  })
})

describe('s3 isAllowedAttachmentType', () => {
  it('blocks executables/scripts (param-stripped, lowercased), allows others', () => {
    expect(isAllowedAttachmentType('image/png')).toBe(true)
    expect(isAllowedAttachmentType('application/x-sh; charset=utf-8')).toBe(false)
    expect(isAllowedAttachmentType('APPLICATION/X-MSDOWNLOAD')).toBe(false)
  })
})

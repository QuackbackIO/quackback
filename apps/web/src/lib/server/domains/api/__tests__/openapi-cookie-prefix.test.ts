import { describe, expect, it } from 'vitest'
import { generateOpenAPISpec } from '../openapi'

describe('OpenAPI cookie authentication names', () => {
  it.each([
    ['better-auth', undefined],
    ['feedback', 'feedback'],
  ])('documents the %s namespace', (expectedPrefix, cookiePrefix) => {
    const schemes = generateOpenAPISpec(cookiePrefix).components?.securitySchemes
    expect(schemes?.sessionCookie).toMatchObject({
      name: `__Secure-${expectedPrefix}.session_token`,
    })
    expect(schemes?.sessionCookieHttp).toMatchObject({ name: `${expectedPrefix}.session_token` })
  })
})

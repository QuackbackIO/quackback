import { describe, expect, it } from 'vitest'
import { isPreviewToken, rootContextRequest } from '../preview-link'

const token = `qbp_${'Ab9-_'.repeat(8)}xyz`

describe('preview link tokens', () => {
  it('are the prefix and 43 base64url characters, nothing else', () => {
    expect(isPreviewToken(token)).toBe(true)
    expect(isPreviewToken(token.slice(0, -1))).toBe(false)
    expect(isPreviewToken(`${token}a`)).toBe(false)
    expect(isPreviewToken(token.replace('qbp_', 'qb_'))).toBe(false)
    expect(isPreviewToken(token.replace('A', '+'))).toBe(false)
    expect(isPreviewToken(undefined)).toBe(false)
  })
})

describe('what the root context asks for', () => {
  it('asks for the portal drawn with a preview link’s design, kept apart by its token', () => {
    expect(rootContextRequest({ share: token })).toEqual({
      data: { previewToken: token },
      key: `share:${token}`,
    })
  })

  it('asks for the switch preview, or for nothing more', () => {
    expect(rootContextRequest({ design: 'switch' })).toEqual({
      data: { designPreview: 'switch' },
      key: 'switch',
    })
    expect(rootContextRequest({ share: 'nonsense' })).toEqual({ data: undefined, key: '' })
    expect(rootContextRequest({})).toEqual({ data: undefined, key: '' })
  })
})

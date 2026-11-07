/**
 * The designer's frame changes nothing: a write it makes, as a server
 * function call or any other request, is refused, and every read goes through.
 */
import { describe, expect, it } from 'vitest'
import { refusesFrameCall, refusesFrameRequest } from '../designer-frame'
import { designerFrameHeaders, designerFrameOf } from '@/lib/shared/design/designer-frame'

const ORIGIN = 'http://acme.localhost'
const FRAME_PAGE = `${ORIGIN}/b/ideas/posts/post_1?preview=true&designer=1&visitor=out`

function request(method: string, path: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { method, headers })
}

describe('refusesFrameCall', () => {
  it('refuses a write the frame calls and lets its reads through', () => {
    const framed = new Headers({ 'x-qb-designer-frame': '1' })
    expect(refusesFrameCall('POST', framed)).toBe(true)
    expect(refusesFrameCall('GET', framed)).toBe(false)
  })

  it('lets a write through from anywhere else', () => {
    expect(refusesFrameCall('POST', new Headers())).toBe(false)
  })
})

describe('refusesFrameRequest', () => {
  it('refuses a write from a designer page: an upload, a sign-in, a vote', () => {
    for (const path of ['/api/portal/upload', '/api/auth/sign-in/anonymous', '/_serverFn/x'])
      expect(refusesFrameRequest(request('POST', path, { referer: FRAME_PAGE }))).toBe(true)
    expect(refusesFrameRequest(request('PUT', '/api/x', { 'x-qb-designer-frame': '1' }))).toBe(true)
  })

  it('lets reads through, and writes from any other page or site', () => {
    expect(refusesFrameRequest(request('GET', '/api/portal/files', { referer: FRAME_PAGE }))).toBe(
      false
    )
    const others = [
      `${ORIGIN}/b/ideas/posts/post_1`,
      `${ORIGIN}/design?path=${encodeURIComponent('/?designer=1')}`,
      `https://elsewhere.example.com/?designer=1`,
      'not a url',
    ]
    for (const referer of others)
      expect(refusesFrameRequest(request('POST', '/api/portal/upload', { referer }))).toBe(false)
    expect(refusesFrameRequest(request('POST', '/api/portal/upload'))).toBe(false)
  })
})

describe('designerFrameOf', () => {
  const view = (search: string, framed = true) => {
    const top = {}
    return { self: framed ? {} : top, top, location: { search } }
  }

  it('reads the frame and its visitor from the first address', () => {
    expect(designerFrameOf(view('?designer=1&visitor=out'))).toEqual({ visitor: 'out' })
    expect(designerFrameOf(view('?designer=1'))).toEqual({ visitor: 'in' })
  })

  it('is no frame at the top, or without the designer flag', () => {
    expect(designerFrameOf(view('?designer=1&visitor=out', false))).toBeNull()
    expect(designerFrameOf(view('?visitor=out'))).toBeNull()
  })

  it('marks the calls of a frame only', () => {
    expect(designerFrameHeaders({ visitor: 'out' })).toEqual({
      'x-qb-designer-frame': '1',
      'x-qb-preview-visitor': 'out',
    })
    expect(designerFrameHeaders({ visitor: 'in' })).toEqual({ 'x-qb-designer-frame': '1' })
    expect(designerFrameHeaders(null)).toEqual({})
  })
})

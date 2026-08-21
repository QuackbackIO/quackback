/**
 * The tripwire is the backstop for leaks no probe thought to check for, so its
 * two failure modes both matter: missing a real marker (a leak goes unreported)
 * and flagging an echo (the suite cries wolf and gets switched off).
 */

import { describe, expect, it } from 'vitest'
import { createTripwire } from '../tripwire'
import { markerSearchForms } from '../db'
import type { Exchange, WorkspaceMarkers } from '../types'

const alpha: WorkspaceMarkers = {
  slot: 'alpha',
  canary: 'qbprobecanaryalpha',
  ids: { postId: 'post_01kzf9qptsfez9r7v4a96xm8fs' },
}
const bravo: WorkspaceMarkers = {
  slot: 'bravo',
  canary: 'qbprobecanarybravo',
  ids: { postId: 'post_01kzf9qptsfez9r7w6rtffezwn' },
}

function exchange(over: Partial<Exchange> = {}): Exchange {
  return {
    workspace: 'bravo',
    method: 'GET',
    url: 'https://bravo.test/api/widget/search',
    status: 200,
    requestBody: '',
    requestHeaders: {},
    responseText: '{}',
    responseHeaders: {},
    durationMs: 1,
    expectsForeignMarkers: false,
    ...over,
  }
}

describe('createTripwire', () => {
  it("flags alpha's canary in a response served by bravo", () => {
    const tripwire = createTripwire(alpha, bravo)
    const hits = tripwire.record(
      exchange({ responseText: `{"content":"fixture qbprobecanaryalpha here"}` })
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ servedBy: 'bravo', markerOwner: 'alpha', markerName: 'canary' })
    expect(tripwire.hitCount()).toBe(1)
  })

  it("flags alpha's id in a response served by bravo", () => {
    const tripwire = createTripwire(alpha, bravo)
    const hits = tripwire.record(
      exchange({ responseText: `{"data":[{"id":"${alpha.ids.postId}"}]}` })
    )
    expect(hits.map((h) => h.markerName)).toEqual(['postId'])
  })

  it("does not flag a workspace's own markers", () => {
    const tripwire = createTripwire(alpha, bravo)
    tripwire.record(exchange({ responseText: `{"content":"qbprobecanarybravo"}` }))
    expect(tripwire.hitCount()).toBe(0)
  })

  it('does not flag an echo of a marker the harness put in the URL', () => {
    const tripwire = createTripwire(alpha, bravo)
    tripwire.record(
      exchange({
        url: 'https://bravo.test/api/widget/search?q=qbprobecanaryalpha',
        responseText: `{"query":"qbprobecanaryalpha","data":{"posts":[]}}`,
      })
    )
    expect(tripwire.hitCount()).toBe(0)
  })

  it('does not flag an echo of a marker the harness put in the request body', () => {
    const tripwire = createTripwire(alpha, bravo)
    tripwire.record(
      exchange({
        method: 'POST',
        requestBody: JSON.stringify({ q: alpha.ids.postId }),
        responseText: `{"error":"no such post ${alpha.ids.postId}"}`,
      })
    )
    expect(tripwire.hitCount()).toBe(0)
  })

  it('COUNTS a hit on an exchange marked expectsForeignMarkers, and labels it deliberate', () => {
    // The defect this pins: the flag used to return the hit and drop it from
    // the collection. Every deliberate cross-workspace attempt in the suite sets
    // it, so the tripwire was switched off on exactly the replays it exists to
    // backstop — its real coverage was incidental traffic only.
    const tripwire = createTripwire(alpha, bravo)
    const hits = tripwire.record(
      exchange({ expectsForeignMarkers: true, responseText: 'qbprobecanaryalpha' })
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].deliberate).toBe(true)
    expect(tripwire.hitCount()).toBe(1)
  })

  it('does not flag an echo of a marker the harness put in a request header', () => {
    // A replayed session cookie or Bearer credential travels in a header and
    // nowhere else, so the header is part of "what the harness put on the wire".
    const tripwire = createTripwire(alpha, bravo)
    tripwire.record(
      exchange({
        expectsForeignMarkers: true,
        requestHeaders: { cookie: `probe=${alpha.ids.postId}` },
        responseText: `{"error":"unknown session ${alpha.ids.postId}"}`,
      })
    )
    expect(tripwire.hitCount()).toBe(0)
  })

  it('does not flag an echo of a marker the harness sent inside a base64url token payload', () => {
    // A signed identify token carries `sub` inside a base64url payload, so the
    // id is genuinely present in the request while appearing nowhere in it
    // verbatim. Without the decode this would be a false LEAK on a correct
    // fleet — and the response to that would be to switch the tripwire off,
    // which is how it went blind the first time.
    const payload = Buffer.from(JSON.stringify({ sub: alpha.ids.postId })).toString('base64url')
    const tripwire = createTripwire(alpha, bravo)
    tripwire.record(
      exchange({
        method: 'POST',
        expectsForeignMarkers: true,
        requestBody: JSON.stringify({ ssoToken: `header.${payload}.sig` }),
        responseText: `{"error":{"code":"TOKEN_INVALID","sub":"${alpha.ids.postId}"}}`,
      })
    )
    expect(tripwire.hitCount()).toBe(0)
  })

  it('ignores markers too short to be distinctive', () => {
    const tripwire = createTripwire({ slot: 'alpha', canary: 'abc', ids: { x: 'short' } }, bravo)
    tripwire.record(exchange({ responseText: 'abc short' }))
    expect(tripwire.hitCount()).toBe(0)
  })

  it('attributes hits to the probe that made them via hitsSince', () => {
    const tripwire = createTripwire(alpha, bravo)
    tripwire.record(exchange({ responseText: 'qbprobecanaryalpha' }))
    const mark = tripwire.hitCount()
    tripwire.record(exchange({ responseText: 'clean' }))
    expect(tripwire.hitsSince(mark)).toHaveLength(0)
    tripwire.record(exchange({ responseText: alpha.ids.postId }))
    expect(tripwire.hitsSince(mark)).toHaveLength(1)
  })

  it('picks up a vocabulary installed after preflight', () => {
    const tripwire = createTripwire(
      { slot: 'alpha', canary: '', ids: {} },
      { slot: 'bravo', canary: '', ids: {} }
    )
    tripwire.record(exchange({ responseText: 'qbprobecanaryalpha' }))
    expect(tripwire.hitCount()).toBe(0)
    tripwire.setMarkers(alpha, bravo)
    tripwire.record(exchange({ responseText: 'qbprobecanaryalpha' }))
    expect(tripwire.hitCount()).toBe(1)
  })
})

describe('markerSearchForms', () => {
  it('expands a TypeID into both its TypeID and uuid forms', () => {
    // Entity ids are uuid columns in Postgres, so a database scan for the
    // TypeID string alone matches nothing and would always look clean.
    const forms = markerSearchForms(alpha.ids.postId)
    expect(forms).toHaveLength(2)
    expect(forms[0]).toBe(alpha.ids.postId)
    expect(forms[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('leaves a non-TypeID value alone', () => {
    expect(markerSearchForms('qbprobecanaryalpha')).toEqual(['qbprobecanaryalpha'])
  })
})

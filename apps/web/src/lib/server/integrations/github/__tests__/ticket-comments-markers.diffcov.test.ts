/**
 * Differential-coverage tests for the github ticket-comments marker helpers
 * (parse/strip/build for thread + system markers).
 */
import { describe, it, expect } from 'vitest'
import {
  parseQuackbackThreadMarker,
  stripQuackbackThreadMarker,
  buildQuackbackThreadMarker,
  parseQuackbackSystemMarker,
  buildQuackbackSystemMarker,
} from '../ticket-comments'

describe('thread markers', () => {
  it('builds, parses, and strips a thread marker', () => {
    const marker = buildQuackbackThreadMarker({
      ticketId: 't1',
      threadId: 'th1',
      integrationId: 'i1',
    })
    const body = `Hello world\n${marker}`
    expect(parseQuackbackThreadMarker(body)).toEqual({
      ticketId: 't1',
      threadId: 'th1',
      integrationId: 'i1',
    })
    expect(stripQuackbackThreadMarker(body)).toBe('Hello world')
  })
  it('returns null / passes through when no marker is present', () => {
    expect(parseQuackbackThreadMarker('no marker')).toBeNull()
    expect(parseQuackbackThreadMarker(null)).toBeNull()
    expect(stripQuackbackThreadMarker(undefined)).toBe('')
  })
})

describe('system markers', () => {
  it('builds and parses a system marker', () => {
    const marker = buildQuackbackSystemMarker({ integrationId: 'i1', event: 'ticket.created' })
    expect(parseQuackbackSystemMarker(marker)).toEqual({
      integrationId: 'i1',
      event: 'ticket.created',
    })
    expect(parseQuackbackSystemMarker('plain')).toBeNull()
  })
})

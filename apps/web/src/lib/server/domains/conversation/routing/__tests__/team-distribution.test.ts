import { describe, it, expect } from 'vitest'
import { pickRoundRobin } from '../team-distribution'
import type { PrincipalId } from '@quackback/ids'

const p = (s: string) => s as PrincipalId

describe('pickRoundRobin', () => {
  it('returns null with no candidates', () => {
    expect(pickRoundRobin([], null)).toBeNull()
    expect(pickRoundRobin([], p('a'))).toBeNull()
  })

  it('starts at the lexicographically first member when the cursor is null', () => {
    expect(pickRoundRobin([p('c'), p('a'), p('b')], null)).toBe('a')
  })

  it('advances to the next member after the cursor', () => {
    const order = [p('a'), p('b'), p('c')]
    expect(pickRoundRobin(order, p('a'))).toBe('b')
    expect(pickRoundRobin(order, p('b'))).toBe('c')
  })

  it('wraps around from the last member to the first', () => {
    expect(pickRoundRobin([p('a'), p('b'), p('c')], p('c'))).toBe('a')
  })

  it('restarts from the top when the cursor is no longer a candidate', () => {
    // The cursored member went offline / left the team.
    expect(pickRoundRobin([p('b'), p('c')], p('a'))).toBe('b')
  })

  it('is stable regardless of input order', () => {
    expect(pickRoundRobin([p('c'), p('b'), p('a')], p('a'))).toBe('b')
  })

  it('returns the sole member repeatedly', () => {
    expect(pickRoundRobin([p('a')], p('a'))).toBe('a')
  })
})

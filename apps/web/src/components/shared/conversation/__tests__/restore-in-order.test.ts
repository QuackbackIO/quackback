import { describe, it, expect } from 'vitest'
import { restoreInOrder } from '../visitor-conversation-thread'

const m = (id: string, createdAt: string) => ({ id, createdAt })

describe('restoreInOrder', () => {
  it('puts a message back between its neighbours, keeping ones that arrived meanwhile', () => {
    const thread = [m('a', '2026-09-23T10:00:00Z'), m('c', '2026-09-23T10:02:00Z')]
    // 'd' arrived over SSE while the failed delete was in flight.
    const withNew = [...thread, m('d', '2026-09-23T10:03:00Z')]
    expect(restoreInOrder(withNew, m('b', '2026-09-23T10:01:00Z')).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('appends a message newer than everything loaded', () => {
    expect(
      restoreInOrder([m('a', '2026-09-23T10:00:00Z')], m('b', '2026-09-23T10:05:00Z')).map(
        (x) => x.id
      )
    ).toEqual(['a', 'b'])
  })

  it('breaks a same-instant tie by id', () => {
    const at = '2026-09-23T10:00:00Z'
    expect(restoreInOrder([m('a', at), m('c', at)], m('b', at)).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
